import { getAmplifyDataClientConfig } from '@aws-amplify/backend/function/runtime';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { ECSClient, ListTasksCommand, RunTaskCommand } from '@aws-sdk/client-ecs';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { Amplify } from 'aws-amplify';
import { generateClient } from 'aws-amplify/data';
import { env } from '$amplify/env/startJob';
import type { Schema } from '../../data/resource';

const { resourceConfig, libraryOptions } = await getAmplifyDataClientConfig(env);
Amplify.configure(resourceConfig, libraryOptions);

const dataClient = generateClient<Schema>();
const sqsClient = new SQSClient({});
const ecsClient = new ECSClient({});
const ssmClient = new SSMClient({});

// Name of the SSM parameter holding the worker launch config (injected by
// backend.ts only when the ECS worker is deployed). Cast through `unknown`
// because the generated `env` type may not include this yet.
const workerEnv = env as unknown as {
  WORKER_LAUNCH_CONFIG_PARAM?: string;
};

export const handler: Schema['startJob']['functionHandler'] = async (event) => {
  const trackId = event.arguments.trackId?.trim();
  const youtubeUrl = event.arguments.youtubeUrl?.trim();
  const lyrics = event.arguments.lyrics?.trim();
  const title = event.arguments.title?.trim() || undefined;
  const artist = event.arguments.artist?.trim() || undefined;
  const audioKey = event.arguments.audioKey?.trim() || undefined;

  if (!trackId || !youtubeUrl || !lyrics) {
    throw new Error('trackId, youtubeUrl, and lyrics are required.');
  }

  const owner = resolveOwner(event.identity);
  const queuedAt = new Date().toISOString();

  const { data: job, errors } = await dataClient.models.Job.create({
    trackId,
    youtubeUrl,
    title,
    artist,
    lyrics,
    status: 'QUEUED',
    progressLog: `${queuedAt} QUEUED`,
    owner,
  });

  if (errors?.length || !job?.id) {
    throw new Error(errors?.[0]?.message ?? 'Failed to create Job.');
  }

  try {
    await sqsClient.send(
      new SendMessageCommand({
        QueueUrl: env.JOB_QUEUE_URL,
        MessageBody: JSON.stringify({
          jobId: job.id,
          youtubeUrl,
          lyrics,
          trackId,
          audioKey,
          title,
          artist,
        }),
      }),
    );

    // Launch the worker Fargate task on demand (scale-to-zero without relying
    // on CloudWatch-alarm Auto Scaling). Skip if a worker is already running.
    if (workerEnv.WORKER_LAUNCH_CONFIG_PARAM) {
      await ensureWorkerRunning(workerEnv.WORKER_LAUNCH_CONFIG_PARAM);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown SQS error';
    await dataClient.models.Job.update({
      id: job.id,
      status: 'FAILED',
      progressLog: `${job.progressLog ?? ''}\nFailed to enqueue: ${reason}`,
    });
    throw new Error(`Job created but failed to enqueue: ${reason}`);
  }

  return job;
};

async function ensureWorkerRunning(paramName: string): Promise<void> {
  try {
    const paramResp = await ssmClient.send(
      new GetParameterCommand({ Name: paramName }),
    );
    const raw = paramResp.Parameter?.Value;
    if (!raw) return;

    const config = JSON.parse(raw) as {
      clusterArn: string;
      taskDefArn: string;
      subnets: string[];
      sg: string;
    };

    const listResp = await ecsClient.send(
      new ListTasksCommand({
        cluster: config.clusterArn,
        desiredStatus: 'RUNNING',
      }),
    );
    if ((listResp.taskArns ?? []).length > 0) {
      return; // a worker is already running/pending
    }
    await ecsClient.send(
      new RunTaskCommand({
        cluster: config.clusterArn,
        taskDefinition: config.taskDefArn,
        launchType: 'FARGATE',
        count: 1,
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: config.subnets,
            securityGroups: [config.sg],
            assignPublicIp: 'ENABLED',
          },
        },
      }),
    );
  } catch (err) {
    // The message is already in SQS; log and don't fail the job here.
    console.error('Failed to launch worker task:', err);
  }
}

function resolveOwner(identity: unknown): string | undefined {
  if (!identity || typeof identity !== 'object') {
    return undefined;
  }

  const record = identity as {
    sub?: string;
    username?: string;
    claims?: Record<string, unknown>;
  };
  const sub =
    typeof record.sub === 'string'
      ? record.sub
      : typeof record.claims?.sub === 'string'
        ? (record.claims.sub as string)
        : undefined;

  // `allow.owner()` authorizes against `sub`, `username`, or `<sub>::<username>`.
  // In the data-handler context `event.identity.username` is aliased to `sub`,
  // so storing just `sub` is the value that reliably matches the frontend check.
  return sub ?? record.username;
}
