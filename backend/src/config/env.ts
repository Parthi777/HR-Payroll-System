import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),

  // Accepts both Postgres URLs (prod) and SQLite file: paths (local dev, e.g. file:./dev.db)
  DATABASE_URL: z.string().min(1),
  // No default, deliberately. A default makes "no Redis" indistinguishable from
  // "Redis on localhost", and production has no Redis — so a defaulted value
  // would have the queue dialling a port that nothing listens on. Unset means
  // the WhatsApp queue is off and sends happen inline, which is the old
  // behaviour exactly. See services/queue/whatsapp.queue.ts.
  REDIS_URL: z.string().optional(),

  JWT_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),

  // Multi-tenant: tenants are addressed by subdomain (acme.yourapp.com → "acme").
  // Set this to the apex the web app is served from; unset means subdomain
  // resolution is off and clients must send X-Tenant-Slug (dev, and Android).
  APP_BASE_DOMAIN: z.string().optional(),

  // Addresses allowed to reach /api/platform at all, e.g. "203.0.113.7,
  // 198.51.100.0/24". Unset = reachable from anywhere (the password and the
  // two-step code still apply). Everyone else gets a 404, as if it did not
  // exist. See services/platform/platform-access.ts.
  PLATFORM_ALLOWED_IPS: z.string().optional(),

  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  AWS_REGION: z.string().default('ap-south-1'),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_REKOGNITION_COLLECTION_ID: z.string().default('hr-payroll-faces'),
  AWS_S3_BUCKET: z.string().optional(), // selfie storage; falls back to local disk if unset

  // Google Drive (claim attachments). Two auth modes; when neither is configured,
  // claim files fall back to S3/local so the feature still works in dev.
  // Mode 1 — service account (recommended): file path OR raw JSON string.
  GOOGLE_SERVICE_ACCOUNT_FILE: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  // Mode 2 — OAuth2 (files land in the connected Gmail's Drive).
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REFRESH_TOKEN: z.string().optional(),
  GOOGLE_DRIVE_PARENT_FOLDER_ID: z.string().optional(), // parent folder for per-employee subfolders
  GOOGLE_DRIVE_SHARE_WITH: z.string().optional(), // auto-share created folders with this email

  // "Sign in with Google" on the admin web app — Web-application OAuth client id
  // (used as the audience when verifying Google ID tokens). Unset = feature off.
  GOOGLE_WEB_CLIENT_ID: z.string().optional(),

  WHATSAPP_PROVIDER: z.enum(['wati', 'twilio', 'meta']).default('wati'),
  WATI_API_URL: z.string().optional(),
  WATI_API_TOKEN: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_FROM: z.string().optional(),
  // The exact public webhook URL, when the one derived from the request does
  // not match what Twilio signed (proxies rewrite host and protocol).
  WHATSAPP_WEBHOOK_URL: z.string().optional(),
  META_WHATSAPP_TOKEN: z.string().optional(),
  META_WHATSAPP_PHONE_ID: z.string().optional(),
  META_WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  // Signs every inbound webhook payload. Without it the webhook refuses to act
  // on anything, because it cannot tell Meta from anyone else who finds the URL.
  META_WHATSAPP_APP_SECRET: z.string().optional(),

  FACE_MATCH_THRESHOLD: z.coerce.number().default(85),

  // Branch kiosk (a shared tablet staff punch on).
  //   aws — AWS Rekognition Face Liveness, which is what stops a photo or a
  //         phone screen being held up to the tablet.
  //   off — no liveness check. Only sensible for a supervised tablet or local
  //         development; the punch is then a face match against a still image.
  KIOSK_LIVENESS: z.enum(['aws', 'off']).default('aws'),
  // Rekognition Face Liveness is not offered in every region. It does not have
  // to match AWS_REGION: the session runs wherever this points, and the image
  // it returns is matched against the face collection in AWS_REGION.
  AWS_LIVENESS_REGION: z.string().optional(),
  // AWS's own guidance is 80 and above. Raise it for a busier entrance.
  KIOSK_LIVENESS_THRESHOLD: z.coerce.number().default(80),
  // How long a paired tablet stays signed in. Long by design — a tablet that
  // logs itself out every week is a tablet nobody punches on — and revocable
  // at any moment from Master Control, which is checked on every request.
  KIOSK_TOKEN_DAYS: z.coerce.number().default(180),

  // Razorpay (subscription payments). Unset = no online payment: a signup is
  // still approved and provisioned, and the platform records the payment by
  // hand. The key id reaches the browser; neither secret ever does.
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  // A different secret from the key secret — set it to whatever is configured
  // on the webhook in the Razorpay dashboard. Without it the webhook refuses
  // everything rather than trusting an unsigned call.
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  // Where the public site lives, for building the payment link that is handed
  // to a new dealership. Falls back to a relative path when unset.
  PUBLIC_SITE_URL: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment configuration');
}

export const env = parsed.data;
