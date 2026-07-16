import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';

/** In-app notifications for admins & cashiers (web bell + mobile dashboard). */
export async function notificationRoutes(app: FastifyInstance) {
  const guard = requireRole('SUPER_ADMIN', 'HR_MANAGER', 'BRANCH_MANAGER', 'PAYROLL_ADMIN', 'CASHIER');

  app.get('/admin/notifications', { preHandler: guard }, async (req) => {
    const [notifications, unread] = await Promise.all([
      app.prisma.notification.findMany({
        where: { adminId: req.user.sub },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      app.prisma.notification.count({ where: { adminId: req.user.sub, isRead: false } }),
    ]);
    return { notifications, unread };
  });

  // Register this device's FCM push token (admins and employees alike).
  app.post('/me/fcm-token', { preHandler: authenticate }, async (req) => {
    const { token } = z.object({ token: z.string().min(10) }).parse(req.body);
    if (req.user.role === 'EMPLOYEE') {
      await app.prisma.employee.update({ where: { id: req.user.sub }, data: { fcmToken: token } });
    } else {
      await app.prisma.adminUser.update({ where: { id: req.user.sub }, data: { fcmToken: token } });
    }
    return { ok: true };
  });

  app.patch('/admin/notifications/read', { preHandler: guard }, async (req) => {
    await app.prisma.notification.updateMany({
      where: { adminId: req.user.sub, isRead: false },
      data: { isRead: true },
    });
    return { ok: true };
  });
}
