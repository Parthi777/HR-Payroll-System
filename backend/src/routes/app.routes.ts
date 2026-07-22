import type { FastifyInstance } from 'fastify';
import { isS3Enabled, headObjectMetadata, getSignedSelfieUrl, getObjectBytes } from '../services/storage/storage.service.js';
import { AppError } from '../utils/AppError.js';

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

  // Permanent, shareable download link — always serves the latest published APK.
  // e.g. https://<backend>/api/app/download (send this to staff via WhatsApp).
  app.get('/app/download', async (_req, reply) => {
    if (!isS3Enabled()) throw new AppError('App download is not available', 503);
    const meta = await headObjectMetadata(APK_KEY);
    if (!meta) throw AppError.notFound('No app has been published yet');
    const bytes = await getObjectBytes(APK_KEY);
    reply.header('Content-Type', 'application/vnd.android.package-archive');
    reply.header('Content-Disposition', `attachment; filename="HR-Payroll-v${meta.versionname ?? ''}.apk"`);
    return reply.send(bytes);
  });
}
