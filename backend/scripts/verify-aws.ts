/**
 * Standalone AWS connectivity check for the HR Payroll backend.
 *
 * Validates the credentials in backend/.env against the two AWS services the app
 * relies on: Rekognition (face match) and S3 (selfie storage). It only reports —
 * it never changes app state. The single mutating action (creating the S3 bucket)
 * is opt-in behind --create-bucket.
 *
 *   npx tsx scripts/verify-aws.ts                  # read-only checks (+ S3 round-trip if bucket exists)
 *   npx tsx scripts/verify-aws.ts --create-bucket  # also create AWS_S3_BUCKET if it doesn't exist yet
 */
import 'dotenv/config';
import { RekognitionClient, ListCollectionsCommand } from '@aws-sdk/client-rekognition';
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const region = process.env.AWS_REGION ?? 'ap-south-1';
const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
const collectionId = process.env.AWS_REKOGNITION_COLLECTION_ID ?? 'hr-payroll-faces';
const bucket = process.env.AWS_S3_BUCKET;
const createBucket = process.argv.includes('--create-bucket');

const ok = (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m: string) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const note = (m: string) => console.log(`  • ${m}`);

interface AwsErr {
  name?: string;
  message?: string;
  $metadata?: { httpStatusCode?: number };
}

let failures = 0;

async function main() {
  console.log(`\nAWS connectivity check — region ${region}\n`);

  if (!accessKeyId || !secretAccessKey) {
    bad('AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY missing in backend/.env');
    process.exit(1);
  }
  const credentials = { accessKeyId, secretAccessKey };

  // ── Rekognition (face match) ────────────────────────────────────────────
  console.log('Rekognition (face match):');
  try {
    const rek = new RekognitionClient({ region, credentials });
    const res = await rek.send(new ListCollectionsCommand({}));
    ok(`credentials valid — ${res.CollectionIds?.length ?? 0} collection(s) in ${region}`);
    if (res.CollectionIds?.includes(collectionId)) ok(`collection "${collectionId}" exists`);
    else note(`collection "${collectionId}" not created yet (auto-creates on first face enroll)`);
  } catch (e) {
    failures++;
    const err = e as AwsErr;
    bad(`Rekognition call failed: ${err.name} — ${err.message}`);
  }

  // ── S3 (selfie storage) ─────────────────────────────────────────────────
  console.log('\nS3 (selfie storage):');
  if (!bucket) {
    failures++;
    bad('AWS_S3_BUCKET not set in backend/.env — selfies fall back to local disk');
  } else {
    const s3 = new S3Client({ region, credentials });
    let bucketReady = false;

    try {
      await s3.send(new HeadBucketCommand({ Bucket: bucket }));
      ok(`bucket "${bucket}" exists and is accessible`);
      bucketReady = true;
    } catch (e) {
      const err = e as AwsErr;
      const missing = err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404;
      if (missing && createBucket) {
        try {
          await s3.send(
            new CreateBucketCommand({
              Bucket: bucket,
              CreateBucketConfiguration:
                region === 'us-east-1' ? undefined : { LocationConstraint: region },
            }),
          );
          ok(`created bucket "${bucket}"`);
          bucketReady = true;
        } catch (ce) {
          failures++;
          const cerr = ce as AwsErr;
          bad(`could not create bucket: ${cerr.name} — ${cerr.message}`);
        }
      } else if (missing) {
        failures++;
        bad(`bucket "${bucket}" does not exist — re-run with --create-bucket to create it`);
      } else {
        failures++;
        bad(`HeadBucket failed: ${err.name} — ${err.message}`);
      }
    }

    if (bucketReady) {
      const key = `__verify__/${Date.now()}.txt`;
      try {
        await s3.send(
          new PutObjectCommand({ Bucket: bucket, Key: key, Body: 'ok', ContentType: 'text/plain' }),
        );
        const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), {
          expiresIn: 60,
        });
        const r = await fetch(url);
        if (r.ok && (await r.text()) === 'ok') ok('put → signed GET → read round-trip works');
        else {
          failures++;
          bad(`signed URL fetch returned HTTP ${r.status}`);
        }
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        ok('cleaned up test object');
      } catch (e) {
        failures++;
        const err = e as AwsErr;
        bad(`S3 round-trip failed: ${err.name} — ${err.message}`);
      }
    }
  }

  console.log(
    failures === 0
      ? '\n\x1b[32mAll AWS checks passed.\x1b[0m\n'
      : `\n\x1b[31m${failures} check(s) failed — see above.\x1b[0m\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();
