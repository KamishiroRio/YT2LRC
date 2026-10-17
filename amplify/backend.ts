import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { storage } from './storage/resource';
import { preview } from './functions/preview/resource';
import { startJob } from './functions/startJob/resource';
import { fetchLyrics } from './functions/fetchLyrics/resource';
import { getSignedLrcUrl } from './functions/getSignedLrcUrl/resource';

/**
 * @see https://docs.amplify.aws/react/build-a-backend/ to add storage, functions, and more
 */
const backend = defineBackend({
  auth,
  data,
  storage,
  preview,
  startJob,
  fetchLyrics,
  getSignedLrcUrl,
});

// --- SQS job queue (startJob -> worker) ---
// The queue lives in its own stack so both the data stack (startJob) and the
// worker stack (ECS) depend on it in one direction only, avoiding a circular
// dependency between the worker and data stacks.
const queueStack = backend.createStack('queue');
const jobQueue = new sqs.Queue(queueStack, 'JobQueue', {
  visibilityTimeout: Duration.minutes(30),
  retentionPeriod: Duration.days(4),
});

const workerStack = backend.createStack('worker');

backend.startJob.addEnvironment('JOB_QUEUE_URL', jobQueue.queueUrl);
backend.startJob.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['sqs:SendMessage'],
    resources: [jobQueue.queueArn],
  }),
);

// getSignedLrcUrl generates a pre-signed S3 URL server-side (avoids the
// client-side ListBucket requirement).
backend.getSignedLrcUrl.addEnvironment(
  'LRC_BUCKET_NAME',
  backend.storage.resources.bucket.bucketName,
);
backend.getSignedLrcUrl.resources.lambda.addToRolePolicy(
  new iam.PolicyStatement({
    actions: ['s3:GetObject'],
    resources: [`${backend.storage.resources.bucket.bucketArn}/lrc/*`],
  }),
);


// ---------------------------------------------------------------------------
// Worker infra (ECR + ECS Fargate) — heavy to synthesize/deploy, so it's gated
// behind an env var. Run the worker locally during development instead:
//   npx ampx sandbox                        # light: no ECS/VPC (fast, low RAM)
//   DEPLOY_WORKER=true npx ampx sandbox     # full: also deploys the ECS worker
// ---------------------------------------------------------------------------
const customOutput: Record<string, string> = {
  jobQueueUrl: jobQueue.queueUrl,
  jobQueueArn: jobQueue.queueArn,
  jobsTableName: backend.data.resources.tables['Job'].tableName,
  lrcBucketName: backend.storage.resources.bucket.bucketName,
};

if (process.env.DEPLOY_WORKER === 'true') {
  const workerRepo = new ecr.Repository(workerStack, 'WorkerRepository', {
    repositoryName: 'yt2lrc-worker',
    removalPolicy: RemovalPolicy.RETAIN,
  });

  const workerVpc = new ec2.Vpc(workerStack, 'WorkerVpc', {
    maxAzs: 1,
    natGateways: 0,
    subnetConfiguration: [
      { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
    ],
  });

  const workerCluster = new ecs.Cluster(workerStack, 'WorkerCluster', {
    vpc: workerVpc,
  });

  const workerExecutionRole = new iam.Role(workerStack, 'WorkerExecutionRole', {
    assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    managedPolicies: [
      iam.ManagedPolicy.fromAwsManagedPolicyName(
        'service-role/AmazonECSTaskExecutionRolePolicy',
      ),
    ],
  });
  workerRepo.grantPull(workerExecutionRole);

  const workerTaskDef = new ecs.FargateTaskDefinition(workerStack, 'WorkerTaskDef', {
    memoryLimitMiB: 8192,
    cpu: 2048,
    executionRole: workerExecutionRole,
  });

  workerTaskDef.addContainer('worker', {
    image: ecs.ContainerImage.fromEcrRepository(workerRepo, 'latest'),
    logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'yt2lrc-worker' }),
    environment: {
      JOB_QUEUE_URL: jobQueue.queueUrl,
      JOBS_TABLE_NAME: backend.data.resources.tables['Job'].tableName,
      LRC_BUCKET_NAME: backend.storage.resources.bucket.bucketName,
      AWS_REGION: workerStack.region,
    },
  });

  // Worker runtime permissions
  workerTaskDef.taskRole.addToPrincipalPolicy(
    new iam.PolicyStatement({
      actions: [
        'sqs:ReceiveMessage',
        'sqs:DeleteMessage',
        'sqs:GetQueueAttributes',
        'sqs:ChangeMessageVisibility',
      ],
      resources: [jobQueue.queueArn],
    }),
  );
  workerTaskDef.taskRole.addToPrincipalPolicy(
    new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem'],
      resources: [backend.data.resources.tables['Job'].tableArn],
    }),
  );
  workerTaskDef.taskRole.addToPrincipalPolicy(
    new iam.PolicyStatement({
      actions: ['s3:PutObject'],
      resources: [`${backend.storage.resources.bucket.bucketArn}/lrc/*`],
    }),
  );
  workerTaskDef.taskRole.addToPrincipalPolicy(
    new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [`${backend.storage.resources.bucket.bucketArn}/uploads/*`],
    }),
  );

  new ecs.FargateService(workerStack, 'WorkerService', {
    cluster: workerCluster,
    taskDefinition: workerTaskDef,
    desiredCount: 1,
    assignPublicIp: true,
  });

  customOutput.workerRepoUri = workerRepo.repositoryUri;
}

backend.addOutput({
  custom: customOutput,
});
