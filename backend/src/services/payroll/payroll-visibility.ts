import type { FastifyRequest } from 'fastify';
import { AppError } from '../../utils/AppError.js';
import { getTenantPolicy } from '../settings/tenant-settings.service.js';

export const PAYROLL_HIDDEN_MESSAGE = 'Your company has not shared payroll in the app — please contact HR.';

/**
 * The employee payroll surfaces — payslips, the payslip PDF, the monthly
 * statement — are open only when the dealer has switched on "Show payroll to
 * employees" in Settings. Off is the default: sharing pay with staff is the
 * dealer's decision. The app hides the tab too, but this is what enforces it.
 *
 * Employee tokens only: administrators have their own payroll routes.
 */
export async function assertEmployeePayrollVisible(req: FastifyRequest): Promise<void> {
  if (req.user.role !== 'EMPLOYEE') throw AppError.forbidden('This is the employee view of payroll');
  const policy = await getTenantPolicy(req.server.prisma);
  if (!policy.payroll.visibleToEmployees) throw new AppError(PAYROLL_HIDDEN_MESSAGE, 403);
}
