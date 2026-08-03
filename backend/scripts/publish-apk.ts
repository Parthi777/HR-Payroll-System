/**
 * Publish an APK for the in-app self-update prompt (see routes/app.routes.ts).
 * Uploads to s3://<bucket>/app/latest.apk with version metadata.
 *
 * Multipart, because the APK is ~60 MB and a single PutObject over a slow
 * uplink stalls silently with nothing to retry — one dead part now retries on
 * its own instead of losing the whole upload.
 *
 * Usage: npx tsx scripts/publish-apk.ts <apk-path> <versionCode> <versionName>
 *   e.g. npx tsx scripts/publish-apk.ts ../android/app/build/outputs/apk/debug/app-debug.apk 2 0.2.0
 */
import 'dotenv/config';
import { createReadStream, statSync } from 'fs';
import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { NodeHttpHandler } from '@smithy/node-http-handler';

const PART_SIZE = 5 * 1024 * 1024; // 5 MB — S3's minimum part size

async function main() {
  const [apkPath, versionCode, versionName] = process.argv.slice(2);
  if (!apkPath || !versionCode || !versionName) {
    console.error('Usage: npx tsx scripts/publish-apk.ts <apk-path> <versionCode> <versionName>');
    process.exit(1);
  }
  const total = statSync(apkPath).size;

  const s3 = new S3Client({
    region: process.env.AWS_REGION ?? 'ap-south-1',
    maxAttempts: 5,
    // Without these a half-open socket hangs forever; fail the part and retry.
    requestHandler: new NodeHttpHandler({ connectionTimeout: 15_000, requestTimeout: 120_000 }),
  });

  const upload = new Upload({
    client: s3,
    partSize: PART_SIZE,
    queueSize: 3,
    leavePartsOnError: false, // abort cleanly so no half upload is billed
    params: {
      Bucket: process.env.AWS_S3_BUCKET,
      Key: 'app/latest.apk',
      Body: createReadStream(apkPath),
      ContentType: 'application/vnd.android.package-archive',
      Metadata: { versioncode: versionCode, versionname: versionName },
    },
  });

  upload.on('httpUploadProgress', (p) => {
    const done = p.loaded ?? 0;
    console.log(`  ${(done / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB (${Math.round((done / total) * 100)}%)`);
  });

  await upload.done();
  console.log(`✓ Published v${versionName} (code ${versionCode}, ${(total / 1e6).toFixed(1)} MB) — employees will be prompted on next app launch.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
