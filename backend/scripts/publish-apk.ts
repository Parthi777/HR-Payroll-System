/**
 * Publish an APK for the in-app self-update prompt (see routes/app.routes.ts).
 * Uploads to s3://<bucket>/app/latest.apk with version metadata.
 *
 * Usage: npx tsx scripts/publish-apk.ts <apk-path> <versionCode> <versionName>
 *   e.g. npx tsx scripts/publish-apk.ts ../android/app/build/outputs/apk/debug/app-debug.apk 2 0.2.0
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

async function main() {
  const [apkPath, versionCode, versionName] = process.argv.slice(2);
  if (!apkPath || !versionCode || !versionName) {
    console.error('Usage: npx tsx scripts/publish-apk.ts <apk-path> <versionCode> <versionName>');
    process.exit(1);
  }
  const body = readFileSync(apkPath);
  const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'ap-south-1' });
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: 'app/latest.apk',
      Body: body,
      ContentType: 'application/vnd.android.package-archive',
      Metadata: { versioncode: versionCode, versionname: versionName },
    }),
  );
  console.log(`✓ Published v${versionName} (code ${versionCode}, ${(body.length / 1e6).toFixed(1)} MB) — employees will be prompted on next app launch.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
