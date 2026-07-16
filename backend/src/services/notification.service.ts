import type { PrismaClient } from '@prisma/client';
import { pushToAdmins } from './push.service.js';

/**
 * In-app notifications for the claims workflow, branch-aware:
 *  - new/resubmitted claim → the employee's approver(s)
 *  - approved claim        → the branch's cashier(s) to check + pay
 */

export interface NotifyPayload {
  type: 'CLAIM_SUBMITTED' | 'CLAIM_APPROVED';
  title: string;
  body: string;
  claimId?: string;
}

/** Create the same notification for every recipient (no-op for empty list). */
export async function notifyAdmins(prisma: PrismaClient, adminIds: string[], n: NotifyPayload): Promise<void> {
  if (adminIds.length === 0) return;
  await prisma.notification.createMany({ data: adminIds.map((adminId) => ({ adminId, ...n })) });
  // Real device push too (no-op until Firebase env vars are configured).
  await pushToAdmins(prisma, adminIds, n.title, n.body);
}

/**
 * Who approves this employee's requests: the mapped reporting manager when set,
 * otherwise the branch's managers plus global HR/owner accounts.
 */
export async function approverIds(
  prisma: PrismaClient,
  employee: { branchId: string; reportingManagerId: string | null },
): Promise<string[]> {
  if (employee.reportingManagerId) return [employee.reportingManagerId];
  const admins = await prisma.adminUser.findMany({
    where: {
      isActive: true,
      role: { in: ['SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER'] },
      OR: [{ branchId: null }, { branchId: employee.branchId }],
    },
    select: { id: true },
  });
  return admins.map((a) => a.id);
}

/** The branch's cashiers: branch-scoped ones plus all-branch cashiers. */
export async function cashierIds(prisma: PrismaClient, branchId: string): Promise<string[]> {
  const cashiers = await prisma.adminUser.findMany({
    where: { isActive: true, role: 'CASHIER', OR: [{ branchId: null }, { branchId }] },
    select: { id: true },
  });
  return cashiers.map((c) => c.id);
}
