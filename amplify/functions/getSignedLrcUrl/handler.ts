import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '$amplify/env/getSignedLrcUrl';
import type { Schema } from '../../data/resource';

const s3 = new S3Client({});

export const handler: Schema['getSignedLrcUrl']['functionHandler'] = async (event) => {
  const key = event.arguments.key?.trim();
  if (!key) {
    throw new Error('key is required.');
  }

  const filename = key.split('/').pop() ?? 'lyrics.lrc';
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: env.LRC_BUCKET_NAME,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${filename}"`,
    }),
    { expiresIn: 3600 },
  );

  return { url };
};
