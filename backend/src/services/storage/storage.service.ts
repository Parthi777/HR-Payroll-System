/**
 * Object storage for selfies — AWS S3 (private bucket + signed URLs, per CLAUDE.md).
 * Falls back to local disk when S3 isn't configured so dev works with zero setup.
 */
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../../config/env.js';

export function isS3Enabled(): boolean {
  return !!(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && env.AWS_S3_BUCKET);
}

let _s3: S3Client | null = null;
function s3(): S3Client {
  if (!_s3) {
    _s3 = new S3Client({
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID as string,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY as string,
      },
    });
  }
  return _s3;
}

/** Upload bytes to the bucket and return the stored object key. */
export async function uploadImage(buffer: Buffer, key: string, contentType = 'image/jpeg'): Promise<string> {
  await s3().send(
    new PutObjectCommand({ Bucket: env.AWS_S3_BUCKET, Key: key, Body: buffer, ContentType: contentType }),
  );
  return key;
}

/** Presigned GET URL for a stored object (default 24h, matching the security spec). */
export async function getSignedSelfieUrl(key: string, expiresIn = 86_400): Promise<string> {
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: env.AWS_S3_BUCKET, Key: key }), { expiresIn });
}
