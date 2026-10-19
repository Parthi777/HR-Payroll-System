import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole, type JwtRole } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import { recordAudit } from '../services/audit/audit.service.js';
import {
  TWO_STEP_CLEARED,
  acceptTotp,
  assertNotLocked,
  generateRecoveryCodes,
  recordFailure,
  recoveryCodesLeft,
} from '../services/auth/two-step.service.js';

/** Every Master Control account — each of them signs in with a second step. */
const ADMIN_ROLES: JwtRole[] = ['SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER', 'PAYROLL_ADMIN', 'CASHIER'];

const codeSchema = z.object({ code: z.string().trim().min(1).max(32) });

/**
 * Two-step verification after sign-in: your own status and recovery codes, and
 * a Super Admin clearing a colleague's for a lost or replaced phone.
 *
 * Sign-in itself (password → challenge → code) lives in auth.routes.ts.
 */
export async function adminTwoStepRoutes(app: FastifyInstance) {
  app.get('/admin/me/two-step', { preHandler: requireRole(...ADMIN_ROLES) }, async (req) => {
    const me = await app.prisma.adminUser.findUnique({
      where: { id: req.user.sub },
      select: { totpEnabledAt: true, recoveryCodes: true },
    });
    if (!me) throw AppError.notFound('Account');
    return { enabledAt: me.totpEnabledAt, recoveryCodesLeft: recoveryCodesLeft(me) };
  });

  /**
   * Replace your recovery codes — after using some, or if the printout went
   * missing. Needs a live code from the authenticator, not just the session:
   * a stolen token must not be able to mint itself a way back in.
   */
  app.post(
    '/admin/me/recovery-codes',
    { preHandler: requireRole(...ADMIN_ROLES), config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } },
    async (req) => {
      const { code } = codeSchema.parse(req.body);
      const me = await app.prisma.adminUser.findUnique({ where: { id: req.user.sub } });
      if (!me) throw AppError.notFound('Account');
      if (!me.totpSecret) throw new AppError('Set up two-step verification first — sign out and in again', 400);
      assertNotLocked(me);

      if (!(await acceptTotp(app.prisma, 'admin', me, me.totpSecret, code))) {
        const { locked } = await recordFailure(app.prisma, 'admin', me);
        if (locked) await recordAudit(req, 'ADMIN_TWO_STEP_LOCKED', 'AdminUser', { entityId: me.id, metadata: { account: me.email } });
        throw AppError.unauthorized('That code is not right');
      }

      const { codes, stored } = generateRecoveryCodes();
      await app.prisma.adminUser.update({ where: { id: me.id }, data: { recoveryCodes: stored } });
      await recordAudit(req, 'ADMIN_RECOVERY_CODES_REGENERATED', 'AdminUser', { entityId: me.id, metadata: { account: me.email } });
      return { recoveryCodes: codes };
    },
  );

  /**
   * Clear a colleague's two-step verification, for a lost or replaced phone.
   * They set it up again at their next sign-in. Never your own: a Super Admin
   * who has lost theirs uses a recovery code, or asks another Super Admin, or —
   * the last resort — the platform console.
   */
  app.delete('/admin/users/:id/two-step', { preHandler: requireRole('SUPER_ADMIN') }, async (req) => {
    const { id } = req.params as { id: string };
    if (id === req.user.sub) {
      throw new AppError('You cannot reset your own two-step verification — use a recovery code, or ask another Super Admin', 400);
    }
    const target = await app.prisma.adminUser.findUnique({ where: { id }, select: { id: true, email: true } });
    if (!target) throw AppError.notFound('User');

    await app.prisma.adminUser.update({ where: { id }, data: TWO_STEP_CLEARED });
    await recordAudit(req, 'ADMIN_TWO_STEP_RESET', 'AdminUser', { entityId: id, metadata: { account: target.email } });
    return { ok: true };
  });
}
