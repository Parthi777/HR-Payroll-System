/**
 * Outgoing email, over SMTP — Gmail with an app password, or any other server.
 *
 * Only "Forgot password?" sends mail today, so this is deliberately small: one
 * transport, made on first use, and a switch that says whether mail is set up
 * at all so callers can say so instead of failing quietly.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

type Sender = (mail: Mail) => Promise<void>;

let transport: Transporter | null = null;
/** Set by tests, which read what would have been sent instead of sending it. */
let override: { send: Sender; adminAppUrl: string } | null = null;

/** Tests only: capture mail rather than send it. Pass null to restore. */
export function setMailForTests(o: { send: Sender; adminAppUrl: string } | null): void {
  override = o;
}

/** Where Master Control lives, for links in mail. Never derived from a request. */
export function adminAppUrl(): string | null {
  if (override) return override.adminAppUrl;
  const url = (env.ADMIN_APP_URL || env.PUBLIC_SITE_URL)?.trim();
  return url ? url.replace(/\/+$/, '') : null;
}

/** Can mail be sent, with a link that leads somewhere? */
export function mailConfigured(): boolean {
  if (override) return true;
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && adminAppUrl());
}

export async function sendMail(mail: Mail): Promise<void> {
  if (override) return override.send(mail);
  if (!mailConfigured()) throw new Error('Email is not configured (SMTP_HOST / SMTP_USER / SMTP_PASS)');

  transport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    // 465 is TLS from the first byte; 587 upgrades with STARTTLS.
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  await transport.sendMail({ from: env.MAIL_FROM || env.SMTP_USER, ...mail });
}
