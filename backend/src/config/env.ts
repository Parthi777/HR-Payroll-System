import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),

  // Accepts both Postgres URLs (prod) and SQLite file: paths (local dev, e.g. file:./dev.db)
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Dev-only fixed OTP so check-in can be tested without an SMS provider wired.
  DEV_FIXED_OTP: z.string().optional(),

  JWT_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),

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

  WHATSAPP_PROVIDER: z.enum(['wati', 'twilio', 'meta']).default('wati'),
  WATI_API_URL: z.string().optional(),
  WATI_API_TOKEN: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_FROM: z.string().optional(),
  META_WHATSAPP_TOKEN: z.string().optional(),
  META_WHATSAPP_PHONE_ID: z.string().optional(),
  META_WHATSAPP_VERIFY_TOKEN: z.string().optional(),

  FACE_MATCH_THRESHOLD: z.coerce.number().default(85),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment configuration');
}

export const env = parsed.data;
