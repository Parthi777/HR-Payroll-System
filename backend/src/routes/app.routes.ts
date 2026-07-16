import type { FastifyInstance } from 'fastify';
import { isS3Enabled, headObjectMetadata, getSignedSelfieUrl } from '../services/storage/storage.service.js';

const APK_KEY = 'app/latest.apk';

/**
 * In-app self-update: the Android app calls /app/version at launch and prompts
 * the user when the published versionCode is newer than the installed one.
 * Publish a new APK with: npx tsx scripts/publish-apk.ts <apk> <code> <name>
 */
export async function appRoutes(app: FastifyInstance) {
  app.get('/app/version', async () => {
    if (!isS3Enabled()) return { available: false };
    const meta = await headObjectMetadata(APK_KEY);
    const versionCode = Number(meta?.versioncode ?? 0);
    if (!versionCode) return { available: false };
    return {
      available: true,
      versionCode,
      versionName: meta?.versionname ?? '',
      url: await getSignedSelfieUrl(APK_KEY, 3600),
    };
  });
}
