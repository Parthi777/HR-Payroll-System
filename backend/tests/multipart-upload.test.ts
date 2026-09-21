/**
 * File upload, through the real HTTP stack.
 *
 * Nothing covered multipart before this. It is how a selfie reaches check-in,
 * how a face is enrolled and how a claim's receipt is submitted — the app's
 * busiest path and two of its most important — and @fastify/multipart went from
 * 8 to 10 in the Fastify 5 upgrade with no test to notice if the plugin's
 * behaviour had shifted.
 *
 * Bulk import is the cheapest honest exercise of it: it takes a real multipart
 * body through `req.file()`, and unlike the selfie routes it needs no AWS
 * credentials, so it runs everywhere the database suites run.
 *
 * Needs a database (see tests/isolation.test.ts); skips without one.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import type { FastifyInstance } from 'fastify';
import { platformSignIn } from './support/platform-session.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const suite = TEST_DATABASE_URL ? describe : describe.skip;

const PLATFORM = { email: 'owner@platform.test', name: 'Platform Owner', password: 'platform-owner-pass' };
const ADMIN = { email: 'owner@upload.test', password: 'dealer-admin-password' };
const SLUG = 'upload-motors';

suite('multipart upload', () => {
  let app: FastifyInstance;
  let adminToken: string;

  let ipCounter = 0;
  const freshIp = () => `10.9.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

  /** A multipart body, built by hand so the test owns the exact bytes sent. */
  function multipart(filename: string, contentType: string, content: string) {
    const boundary = '----hrpayrolltestboundary';
    const body = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${filename}"`,
      `Content-Type: ${contentType}`,
      '',
      content,
      `--${boundary}--`,
      '',
    ].join('\r\n');
    return { body, contentType: `multipart/form-data; boundary=${boundary}` };
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const { buildServer } = await import('../src/server.js');
    app = await buildServer();
    await app.ready();

    const p = app.prisma;
    const { runUnscoped } = await import('../src/context/tenant-context.js');
    await runUnscoped('test teardown', async () => {
      for (const del of [
        p.gPSLog, p.claimMessage, p.claim, p.attendance, p.leave, p.leaveBalance,
        p.payslip, p.notification, p.whatsAppLog, p.geofenceViolation, p.auditLog,
        p.kioskDevice, p.attendanceReminder, p.employee, p.adminUser, p.branch, p.department, p.designation, p.shift,
        p.holiday, p.tenantSettings,
      ]) {
        await (del as { deleteMany: (a?: unknown) => Promise<unknown> }).deleteMany({});
      }
    });
    await p.platformAuditLog.deleteMany({});
    await p.tenant.deleteMany({});
    await p.platformUser.deleteMany({});

    await p.platformUser.create({
      data: { email: PLATFORM.email, name: PLATFORM.name, passwordHash: await bcrypt.hash(PLATFORM.password, 4) },
    });
    const platformToken = await platformSignIn(app, PLATFORM, freshIp);

    const made = await app.inject({
      method: 'POST', url: '/api/platform/tenants',
      headers: { authorization: `Bearer ${platformToken}` },
      payload: {
        slug: SLUG, name: 'Upload Motors',
        admin: { name: 'Owner', email: ADMIN.email, password: ADMIN.password },
      },
    });
    expect(made.statusCode, made.body).toBe(201);

    const login = await app.inject({
      method: 'POST', url: '/api/auth/admin/login', remoteAddress: freshIp(),
      headers: { 'x-tenant-slug': SLUG }, payload: ADMIN,
    });
    expect(login.statusCode, login.body).toBe(200);
    adminToken = login.json().token;
  }, 90_000);

  afterAll(async () => {
    await app?.close();
  });

  const upload = (content: string, filename = 'staff.csv') => {
    const { body, contentType } = multipart(filename, 'text/csv', content);
    return app.inject({
      method: 'POST', url: '/api/admin/employees/bulk-import',
      headers: { authorization: `Bearer ${adminToken}`, 'x-tenant-slug': SLUG, 'content-type': contentType },
      payload: body,
    });
  };

  it('receives an uploaded file and acts on its contents', async () => {
    const res = await upload('name,phone,salary\nAsha Kumar,+919000000801,18000\nRavi Singh,+919000000802,21000');
    expect(res.statusCode, res.body).toBe(200);

    const { runInTenant } = await import('../src/context/tenant-context.js');
    const tenant = await app.prisma.tenant.findUnique({ where: { slug: SLUG } });
    const people = await runInTenant(
      { tenantId: tenant!.id, subjectId: 'test', role: 'SUPER_ADMIN' },
      () => app.prisma.employee.findMany({ orderBy: { name: 'asc' } }),
    );
    expect(people.map((e) => e.name)).toEqual(['Asha Kumar', 'Ravi Singh']);
  }, 30_000);

  it('stamps imported rows with the uploading admin’s tenant', async () => {
    // An import is a bulk write through a path that never names a tenant. It
    // gets one from the request context like everything else, or the extension
    // refuses the write outright.
    const tenant = await app.prisma.tenant.findUnique({ where: { slug: SLUG } });
    const { runUnscoped } = await import('../src/context/tenant-context.js');
    const all = await runUnscoped('assert', () => app.prisma.employee.findMany());
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((e) => e.tenantId === tenant!.id)).toBe(true);
  });

  it('rejects a request carrying no file', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/admin/employees/bulk-import',
      headers: { authorization: `Bearer ${adminToken}`, 'x-tenant-slug': SLUG },
      payload: {},
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('rejects a CSV without the columns it needs', async () => {
    const res = await upload('nickname,mobile\nAsha,+919000000803');
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain('name, phone, salary');
  });

  it('refuses an unauthenticated upload', async () => {
    const { body, contentType } = multipart('staff.csv', 'text/csv', 'name,phone,salary\nX,+919000000804,1');
    const res = await app.inject({
      method: 'POST', url: '/api/admin/employees/bulk-import',
      headers: { 'x-tenant-slug': SLUG, 'content-type': contentType },
      payload: body,
    });
    expect(res.statusCode).toBe(401);
  });
});
