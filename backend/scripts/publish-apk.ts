/**
 * Publish an APK for the in-app self-update prompt (see routes/app.routes.ts).
 * Uploads to s3://<bucket>/app/latest.apk with version metadata.
 *
 * Multipart, because the APK is ~60 MB and a single PutObject over a slow
 * uplink stalls silently with nothing to retry — one dead part now retries on
 * its own instead of losing the whole upload.
 *
 * The version is read out of the build itself (output-metadata.json, or aapt2),
 * never from a hand-typed argument: advertising a versionCode the APK does not
 * carry leaves every device prompting at every launch forever, because no
 * install can ever satisfy it.
 *
 * Usage: npx tsx scripts/publish-apk.ts <apk-path> [versionCode] [versionName]
 *   e.g. npx tsx scripts/publish-apk.ts ../android/app/build/outputs/apk/debug/app-debug.apk
 * Any version passed is only cross-checked against the APK; --force allows
 * republishing over a newer build.
 */
import 'dotenv/config';
import { createReadStream, existsSync, openSync, readFileSync, readSync, closeSync, readdirSync, statSync } from 'fs';
import { basename, dirname, join } from 'path';
import { homedir } from 'os';
import { execFileSync } from 'child_process';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { NodeHttpHandler } from '@smithy/node-http-handler';

const PART_SIZE = 5 * 1024 * 1024; // 5 MB — S3's minimum part size
const KEY = 'app/latest.apk';

type Version = { versionCode: number; versionName: string; source: string };

/** APKs are zip files; anything else would be published as an uninstallable blob. */
function assertIsApk(apkPath: string) {
  const fd = openSync(apkPath, 'r');
  const magic = Buffer.alloc(4);
  try {
    readSync(fd, magic, 0, 4, 0);
  } finally {
    closeSync(fd);
  }
  if (magic.toString('binary', 0, 2) !== 'PK') {
    throw new Error(`${apkPath} is not an APK (no zip header) — publish the file from build/outputs/apk/…`);
  }
}

/** AGP writes output-metadata.json next to every APK it builds. */
function fromBuildMetadata(apkPath: string): Version | null {
  const metaPath = join(dirname(apkPath), 'output-metadata.json');
  if (!existsSync(metaPath)) return null;
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    const el =
      meta.elements?.find((e: { outputFile?: string }) => e.outputFile === basename(apkPath)) ??
      (meta.elements?.length === 1 ? meta.elements[0] : null);
    if (!el?.versionCode) return null;
    return {
      versionCode: Number(el.versionCode),
      versionName: String(el.versionName ?? ''),
      source: 'output-metadata.json',
    };
  } catch {
    return null;
  }
}

/** Fallback for an APK that was moved away from its build directory. */
function fromAapt2(apkPath: string): Version | null {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? join(homedir(), 'Library/Android/sdk');
  const buildTools = join(sdk, 'build-tools');
  if (!existsSync(buildTools)) return null;
  const newest = readdirSync(buildTools).sort().pop();
  if (!newest) return null;
  const aapt2 = join(buildTools, newest, 'aapt2');
  if (!existsSync(aapt2)) return null;
  try {
    const out = execFileSync(aapt2, ['dump', 'badging', apkPath], { encoding: 'utf8' });
    const code = out.match(/versionCode='(\d+)'/)?.[1];
    const name = out.match(/versionName='([^']*)'/)?.[1];
    if (!code) return null;
    return { versionCode: Number(code), versionName: name ?? '', source: `aapt2 (${newest})` };
  } catch {
    return null;
  }
}

function resolveVersion(apkPath: string, argCode?: string, argName?: string): Version {
  const found = fromBuildMetadata(apkPath) ?? fromAapt2(apkPath);

  if (!found) {
    if (!argCode || !argName) {
      throw new Error(
        'Could not read the version from the APK. Publish it straight out of ' +
          'android/app/build/outputs/apk/… (so output-metadata.json sits beside it), ' +
          'or install Android build-tools for the aapt2 fallback.',
      );
    }
    console.warn(`⚠️  Version not readable from the APK — trusting what you typed (${argName}, code ${argCode}).`);
    return { versionCode: Number(argCode), versionName: argName, source: 'command line' };
  }

  // Arguments are now only a cross-check — a mismatch means one of the two is wrong.
  if (argCode && Number(argCode) !== found.versionCode) {
    throw new Error(
      `versionCode mismatch: you passed ${argCode}, but the APK is ${found.versionCode} (${found.source}).\n` +
        'Publishing the typed value would prompt every device forever. Drop the argument — it is read from the APK.',
    );
  }
  if (argName && argName !== found.versionName) {
    throw new Error(
      `versionName mismatch: you passed ${argName}, but the APK is ${found.versionName} (${found.source}).`,
    );
  }
  return found;
}

/** Refuse to go backwards — devices on the newer build could never satisfy the prompt. */
async function assertNotOlder(s3: S3Client, next: Version, force: boolean) {
  const current = await s3
    .send(new HeadObjectCommand({ Bucket: process.env.AWS_S3_BUCKET, Key: KEY }))
    .catch(() => null);
  const live = Number(current?.Metadata?.versioncode ?? 0);
  if (!live) return;

  if (next.versionCode < live && !force) {
    throw new Error(
      `Published build is code ${live}; refusing to go back to ${next.versionCode}. Pass --force if you mean it.`,
    );
  }
  if (next.versionCode === live) {
    console.warn(`⚠️  Replacing the published build in place (both are code ${live}) — nobody will be prompted to update.`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const [apkPath, versionCode, versionName] = args.filter((a) => a !== '--force');
  if (!apkPath) {
    console.error('Usage: npx tsx scripts/publish-apk.ts <apk-path> [versionCode] [versionName] [--force]');
    process.exit(1);
  }
  if (!process.env.AWS_S3_BUCKET) throw new Error('AWS_S3_BUCKET is not set');

  assertIsApk(apkPath);
  const version = resolveVersion(apkPath, versionCode, versionName);
  const total = statSync(apkPath).size;

  const s3 = new S3Client({
    region: process.env.AWS_REGION ?? 'ap-south-1',
    maxAttempts: 5,
    // Without these a half-open socket hangs forever; fail the part and retry.
    requestHandler: new NodeHttpHandler({ connectionTimeout: 15_000, requestTimeout: 120_000 }),
  });

  await assertNotOlder(s3, version, force);
  console.log(
    `Publishing ${basename(apkPath)} — v${version.versionName} (code ${version.versionCode}, read from ${version.source})`,
  );

  const upload = new Upload({
    client: s3,
    partSize: PART_SIZE,
    queueSize: 3,
    leavePartsOnError: false, // abort cleanly so no half upload is billed
    params: {
      Bucket: process.env.AWS_S3_BUCKET,
      Key: KEY,
      Body: createReadStream(apkPath),
      ContentType: 'application/vnd.android.package-archive',
      Metadata: { versioncode: String(version.versionCode), versionname: version.versionName },
    },
  });

  upload.on('httpUploadProgress', (p) => {
    const done = p.loaded ?? 0;
    console.log(`  ${(done / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB (${Math.round((done / total) * 100)}%)`);
  });

  await upload.done();
  console.log(
    `✓ Published v${version.versionName} (code ${version.versionCode}, ${(total / 1e6).toFixed(1)} MB) — employees will be prompted on next app launch.`,
  );
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
