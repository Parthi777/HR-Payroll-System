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
import { notificationRoutes } from './notification.routes.js';
import { auditRoutes } from './audit.routes.js';
import { platformRoutes } from './platform.routes.js';
import { publicRoutes } from './public.routes.js';
import { kioskRoutes } from './kiosk.routes.js';
import { integrationRoutes } from './integration.routes.js';

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
  await app.register(notificationRoutes, { prefix: '/api' });
  await app.register(auditRoutes, { prefix: '/api' });
  // Platform surface — dealer onboarding. Guarded by requirePlatform, not requireRole.
  await app.register(platformRoutes, { prefix: '/api' });
  // The public surface: plans, signup and the payment page. No session at all,
  // and no route in it can reach a dealer's data.
  await app.register(publicRoutes, { prefix: '/api' });
  // The branch kiosk: a paired tablet punching for whoever is in front of it,
  // plus the Master Control screens that pair and revoke one.
  await app.register(kioskRoutes, { prefix: '/api' });
  // The dealer's accounting ERP: Master Control connects it, and its own token
  // opens /api/integration/v1 and nothing else.
  await app.register(integrationRoutes, { prefix: '/api' });
}
