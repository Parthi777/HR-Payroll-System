import { initializeApp, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import type { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger.js';

/**
 * Firebase Cloud Messaging push — real device notifications (banner/sound even
 * when the app is closed). Activates only when the Firebase service-account env
 * vars are set (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY);
 * otherwise every call is a silent no-op so the in-app notifications still work.
 */

let _ready = false;
let _checked = false;

function ensureFirebase(): boolean {
  if (_checked) return _ready;
  _checked = true;
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) return false;
  try {
    initializeApp({
      credential: cert({
        projectId: FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        // Railway stores multiline keys with literal \n
        privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
    _ready = true;
    logger.info('Firebase push enabled');
  } catch (err) {
    logger.warn({ err }, 'Firebase init failed — push disabled');
  }
  return _ready;
}

/** Send a push to a set of device tokens (invalid tokens are ignored). */
export async function sendPush(tokens: string[], title: string, body: string): Promise<void> {
  const valid = tokens.filter(Boolean);
  if (valid.length === 0 || !ensureFirebase()) return;
  try {
    await getMessaging().sendEachForMulticast({
      tokens: valid,
      notification: { title, body },
      android: { priority: 'high', notification: { channelId: 'hr_payroll_alerts' } },
    });
  } catch (err) {
    logger.warn({ err }, 'Push send failed');
  }
}

/** Push to one employee's registered device (claim/leave status updates). */
export async function pushToEmployee(prisma: PrismaClient, employeeId: string, title: string, body: string): Promise<void> {
  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { fcmToken: true } });
  if (emp?.fcmToken) await sendPush([emp.fcmToken], title, body);
}

/** Push to admins by id — looks up their registered device tokens. */
export async function pushToAdmins(prisma: PrismaClient, adminIds: string[], title: string, body: string): Promise<void> {
  if (adminIds.length === 0) return;
  const admins = await prisma.adminUser.findMany({
    where: { id: { in: adminIds }, fcmToken: { not: null } },
    select: { fcmToken: true },
  });
  await sendPush(admins.map((a) => a.fcmToken as string), title, body);
}
