import type { FastifyInstance } from 'fastify';
import { authRoutes } from './auth.routes.js';
import { attendanceRoutes } from './attendance.routes.js';
import { geofenceRoutes } from './geofence.routes.js';
import { employeeRoutes } from './employee.routes.js';
import { leaveRoutes } from './leave.routes.js';
import { shiftRoutes } from './shift.routes.js';
import { payrollRoutes } from './payroll.routes.js';
import { whatsappRoutes } from './whatsapp.routes.js';
import { masterRoutes } from './master.routes.js';
import { claimRoutes } from './claim.routes.js';
import { profileRoutes } from './profile.routes.js';
import { adminUsersRoutes } from './admin-users.routes.js';
import { reportsRoutes } from './reports.routes.js';
import { appRoutes } from './app.routes.js';

export async function registerRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(attendanceRoutes, { prefix: '/api' });
  await app.register(geofenceRoutes, { prefix: '/api' });
  await app.register(employeeRoutes, { prefix: '/api/admin/employees' });
  await app.register(leaveRoutes, { prefix: '/api' });
  await app.register(shiftRoutes, { prefix: '/api' });
  await app.register(payrollRoutes, { prefix: '/api' });
  await app.register(whatsappRoutes, { prefix: '/api' });
  await app.register(masterRoutes, { prefix: '/api' });
  await app.register(claimRoutes, { prefix: '/api' });
  await app.register(profileRoutes, { prefix: '/api' });
  await app.register(adminUsersRoutes, { prefix: '/api' });
  await app.register(reportsRoutes, { prefix: '/api' });
  await app.register(appRoutes, { prefix: '/api' });
}
