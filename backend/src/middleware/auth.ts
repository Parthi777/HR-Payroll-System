import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../utils/AppError.js';

export type JwtRole =
  | 'EMPLOYEE'
  | 'SUPER_ADMIN'
  | 'HR_MANAGER'
  | 'BRANCH_MANAGER'
  | 'PAYROLL_ADMIN'
  | 'CASHIER';

export interface JwtPayload {
  sub: string; // employeeId or adminId
  role: JwtRole;
  branchId?: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

/** Verify a valid JWT is present. Attach payload to request.user. */
export async function authenticate(request: FastifyRequest, _reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    throw AppError.unauthorized('Missing or invalid token');
  }
}

/** Role-based access control. SUPER_ADMIN > HR_MANAGER > BRANCH_MANAGER > PAYROLL_ADMIN. */
export function requireRole(...roles: JwtRole[]) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    await authenticate(request, _reply);
    if (!roles.includes(request.user.role)) {
      throw AppError.forbidden('Insufficient permissions');
    }
  };
}
