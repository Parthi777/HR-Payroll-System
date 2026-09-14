import type { FastifyInstance } from 'fastify';
import { isS3Enabled, headObjectMetadata, getSignedSelfieUrl } from '../services/storage/storage.service.js';
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
      // 6h, not 1h: a ~60 MB APK over a weak mobile link can outlive a short
      // signature and 403 mid-download, which leaves the device prompting again.
      url: await getSignedSelfieUrl(APK_KEY, 6 * 3600),
    };
  });

  /**
   * Permanent, shareable download link — always serves the latest published APK.
   * e.g. https://<backend>/api/app/download (send this to staff via WhatsApp).
   *
   * Redirects to a signed S3 URL rather than proxying the bytes. It used to
   * read the whole APK into a Buffer and send it: ~60 MB of heap per request,
   * unauthenticated and unthrottled, on a single backend instance — a handful
   * of concurrent requests was an easy way to exhaust memory and bill the
   * egress to us. The link stays permanent and always current; only the hop
   * changes, and S3 serves the bytes.
   *
   * Rate-limited because presigning is cheap but not free, and because a public
   * endpoint with no ceiling is how you find out what a botnet costs. Generous
   * enough for a whole branch installing at once from one NAT address.
   *
   * 6h signature: a ~60 MB download over a weak mobile link can outlive a short
   * one and 403 midway, which leaves the device prompting again.
   */
  app.get(
    '/app/download',
    { config: { rateLimit: { max: 30, timeWindow: '10 minutes' } } },
    async (_req, reply) => {
      if (!isS3Enabled()) throw new AppError('App download is not available', 503);
      const meta = await headObjectMetadata(APK_KEY);
      if (!meta) throw AppError.notFound('No app has been published yet');
      return reply.redirect(await getSignedSelfieUrl(APK_KEY, 6 * 3600));
    },
  );
}
