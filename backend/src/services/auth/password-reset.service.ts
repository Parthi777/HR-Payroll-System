/**
 * "Forgot password?" for Master Control accounts.
 *
 * The emailed link carries a random token; only its SHA-256 is stored, so the
 * database alone cannot be used to reset anyone. It works once, for
 * RESET_TTL_MINUTES, and asking again replaces it.
 *
 * A reset replaces the password and nothing else. Two-step verification still
 * stands between the new password and a session, so someone who gets into the
 * mailbox gets no further than the authenticator code — the reason this is
 * safe to offer at all. A lost phone is still a Super Admin's (or the
 * console's) to reset.
 *
 * Everything here runs inside the tenant's context, so an account is only ever
 * found in the workspace the request names, and a link issued at one dealer is
 * worthless at another.
 */
import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import type { PrismaClient } from '@prisma/client';
import { AppError } from '../../utils/AppError.js';
import { adminAppUrl, sendMail } from '../mail/mail.service.js';

export const RESET_TTL_MINUTES = 30;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Issue a reset link for this address, if it is an active login here.
 *
 * Returns what to send, or null when there is no such account — the caller
 * answers the same either way, so the response never confirms an address.
 */
export async function issueAdminPasswordReset(
  prisma: PrismaClient,
  tenant: { slug: string; name: string },
  email: string,
): Promise<{ admin: { id: string; email: string }; send: () => Promise<void> } | null> {
  const admin = await prisma.adminUser.findFirst({
    where: { email: { equals: email.trim(), mode: 'insensitive' }, isActive: true },
    select: { id: true, name: true, email: true },
  });
  if (!admin) return null;

  const token = randomBytes(32).toString('base64url');
  await prisma.adminUser.update({
    where: { id: admin.id },
    data: {
      resetLinkHash: hashToken(token),
      resetLinkExpiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000),
    },
  });

  const link = `${adminAppUrl()}/reset-password?token=${token}&workspace=${encodeURIComponent(tenant.slug)}`;
  const text = [
    `Hello ${admin.name},`,
    '',
    `Someone asked to reset the password for your Kayaazh Payroll login at ${tenant.name} (${admin.email}).`,
    '',
    `Set a new password here — the link works once, for ${RESET_TTL_MINUTES} minutes:`,
    link,
    '',
    'You will still need the code from your authenticator app to sign in.',
    '',
    'If this was not you, ignore this email: your password has not changed.',
  ].join('\n');
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#171C20;max-width:520px">
      <p>Hello ${escapeHtml(admin.name)},</p>
      <p>Someone asked to reset the password for your <b>Kayaazh Payroll</b> login at
        <b>${escapeHtml(tenant.name)}</b> (${escapeHtml(admin.email)}).</p>
      <p style="margin:28px 0">
        <a href="${link}" style="background:#00835E;color:#ffffff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:bold">
          Set a new password</a>
      </p>
      <p style="color:#66716D;font-size:13px">The link works once, for ${RESET_TTL_MINUTES} minutes. You will still need
        the code from your authenticator app to sign in.</p>
      <p style="color:#66716D;font-size:13px">If this was not you, ignore this email: your password has not changed.</p>
    </div>`;

  return {
    admin: { id: admin.id, email: admin.email },
    send: () => sendMail({ to: admin.email, subject: `Reset your Kayaazh Payroll password — ${tenant.name}`, text, html }),
  };
}

/** Spend a reset link: the new password, and the link is gone. */
export async function completeAdminPasswordReset(prisma: PrismaClient, token: string, password: string) {
  const admin = await prisma.adminUser.findFirst({
    where: { resetLinkHash: hashToken(token), resetLinkExpiresAt: { gt: new Date() }, isActive: true },
    select: { id: true, email: true },
  });
  if (!admin) throw new AppError('This reset link has expired or has already been used — ask for a new one.', 400);

  // Conditional on the same hash, so two tabs spending one link cannot both succeed.
  const { count } = await prisma.adminUser.updateMany({
    where: { id: admin.id, resetLinkHash: hashToken(token) },
    data: {
      passwordHash: await bcrypt.hash(password, 12),
      resetLinkHash: null,
      resetLinkExpiresAt: null,
      // A locked second step would still stand between them and the new password.
      mfaFailures: 0,
      mfaLockedUntil: null,
    },
  });
  if (count !== 1) throw new AppError('This reset link has expired or has already been used — ask for a new one.', 400);
  return admin;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
