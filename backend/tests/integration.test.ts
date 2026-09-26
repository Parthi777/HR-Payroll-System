/**
 * The dealer's accounting ERP, connected (services/integration).
 *
 * An integration token reads a whole dealership's claims, people and payroll
 * and can mark claims paid, so what is pinned here is what keeps it narrow:
 * it reaches only /api/integration/v1 and only its own dealership; switching it
 * off or rotating it stops it at once; an approval is announced, signed; a
 * claim paid in the ERP cannot also be paid at the counter here, and a paid
 * claim cannot be taken back.
 *
 * Needs a database (see tests/isolation.test.ts); skips without one.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import bcrypt from 'bcrypt';
import type { FastifyInstance } from 'fastify';
import { platformSignIn } from './support/platform-session.js';
import { runInTenant } from '../src/context/tenant-context.js';
import { verifySignature } from '../src/services/integration/integration.service.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const suite = TEST_DATABASE_URL ? describe : describe.skip;

const PLATFORM = { email: 'owner@platform.test', name: 'Platform Owner', password: 'platform-owner-pass' };
const DEALER_PASSWORD = 'integration-dealer-password';
const HOME = { slug: 'erp-motors', owner: 'owner@erp.test' };
const OTHER = { slug: 'other-motors', owner: 'owner@other.test' };

interface Received { headers: Record<string, string | string[] | undefined>; body: string }

suite('the accounting ERP connection', () => {
  let app: FastifyInstance;
  let receiver: Server;
  let receiverUrl = '';
  const received: Received[] = [];
  const dealer: Record<string, { tenantId: string; token: string; employeeId: string }> = {};

  let ipCounter = 0;
  const freshIp = () => `10.7.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

  const asAdmin = (slug: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: unknown) =>
    app.inject({
      method, url, remoteAddress: freshIp(),
      headers: { authorization: `Bearer ${dealer[slug].token}`, 'x-tenant-slug': slug },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  const asErp = (token: string, method: 'GET' | 'POST', url: string, payload?: unknown) =>
    app.inject({
      method, url, remoteAddress: freshIp(),
      headers: { authorization: `Bearer ${token}` },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  const inTenant = <T>(slug: string, fn: () => Promise<T>): Promise<T> =>
    runInTenant({ tenantId: dealer[slug].tenantId, subjectId: 'integration-test', role: 'SUPER_ADMIN' }, fn);

  async function newClaim(slug: string, title: string, amount: number): Promise<string> {
    const claim = await inTenant(slug, () =>
      app.prisma.claim.create({
        data: {
          tenantId: dealer[slug].tenantId, employeeId: dealer[slug].employeeId,
          type: 'PETROL_EXPENSES', title, amount, status: 'PENDING',
        },
      }),
    );
    return claim.id;
  }

  const waitFor = async (predicate: () => boolean, ms = 3000) => {
    const until = Date.now() + ms;
    while (!predicate() && Date.now() < until) await new Promise((r) => setTimeout(r, 25));
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    receiver = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        res.writeHead(200).end('ok');
      });
    });
    await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
    receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;

    const { buildServer } = await import('../src/server.js');
    app = await buildServer();
    await app.ready();

    const p = app.prisma;
    const { runUnscoped } = await import('../src/context/tenant-context.js');
    await runUnscoped('test teardown', async () => {
      for (const del of [
        p.integrationEvent, p.integrationClient,
        p.gPSLog, p.claimMessage, p.claim, p.attendance, p.leave, p.leaveBalance,
        p.payslip, p.notification, p.whatsAppLog, p.geofenceViolation, p.auditLog,
        p.kioskDevice, p.attendanceReminder, p.employee, p.adminUser, p.branch, p.department, p.designation,
        p.shift, p.holiday, p.tenantSettings,
      ]) {
        await (del as { deleteMany: (a?: unknown) => Promise<unknown> }).deleteMany({});
      }
    });
    await p.subscription.deleteMany({});
    await p.signupRequest.deleteMany({});
    await p.platformAuditLog.deleteMany({});
    await p.tenant.deleteMany({});
    await p.platformUser.deleteMany({});

    await p.platformUser.create({
      data: { email: PLATFORM.email, name: PLATFORM.name, passwordHash: await bcrypt.hash(PLATFORM.password, 4) },
    });
    const platformToken = await platformSignIn(app, PLATFORM, freshIp);

    for (const { slug, owner } of [HOME, OTHER]) {
      const made = await app.inject({
        method: 'POST', url: '/api/platform/tenants',
        headers: { authorization: `Bearer ${platformToken}` },
        payload: { slug, name: slug, admin: { name: 'Owner', email: owner, password: DEALER_PASSWORD } },
      });
      expect(made.statusCode, made.body).toBe(201);
      const signIn = await app.inject({
        method: 'POST', url: '/api/auth/admin/login', remoteAddress: freshIp(),
        headers: { 'x-tenant-slug': slug },
        payload: { email: owner, password: DEALER_PASSWORD },
      });
      expect(signIn.statusCode, signIn.body).toBe(200);
      dealer[slug] = { tenantId: made.json().tenant.id, token: signIn.json().token, employeeId: '' };

      const [branches, departments, designations] = (
        await Promise.all(['branches', 'departments', 'designations'].map((k) => asAdmin(slug, 'GET', `/api/admin/${k}`)))
      ).map((r) => r.json());
      const shifts = (await asAdmin(slug, 'GET', '/api/shifts')).json().shifts;
      const employee = await asAdmin(slug, 'POST', '/api/admin/employees', {
        name: `${slug} Staffer`, phone: `+9190001${slug === HOME.slug ? '11111' : '22222'}`,
        branchId: branches.branches[0].id, departmentId: departments.departments[0].id,
        designationId: designations.designations[0].id, shiftId: shifts[0].id,
        joiningDate: '2026-01-01', salary: 20000, password: 'employee-app-password',
      });
      expect(employee.statusCode, employee.body).toBe(200);
      dealer[slug].employeeId = employee.json().employee.id;
    }
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await new Promise<void>((r) => receiver?.close(() => r()));
  });

  let token = '';
  let secret = '';
  let clientId = '';

  it('Master Control connects the ERP and shows the key once', async () => {
    const res = await asAdmin(HOME.slug, 'POST', '/api/admin/integrations', { name: 'Accounting ERP', webhookUrl: receiverUrl });
    expect(res.statusCode, res.body).toBe(200);
    ({ token, webhookSecret: secret } = res.json());
    clientId = res.json().client.id;
    expect(token).toBeTruthy();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    const listed = await asAdmin(HOME.slug, 'GET', '/api/admin/integrations');
    expect(JSON.stringify(listed.json())).not.toContain(secret);
  });

  it('refuses a plain webhook address that is not local', async () => {
    const res = await asAdmin(HOME.slug, 'POST', '/api/admin/integrations', { name: 'Bad', webhookUrl: 'http://erp.example.com/hook' });
    expect(res.statusCode).toBe(422);
  });

  it('announces an approval, signed with the connection\'s secret', async () => {
    const claimId = await newClaim(HOME.slug, 'Fuel for PDI', 450);
    const approved = await asAdmin(HOME.slug, 'PATCH', `/api/admin/claims/${claimId}/approve`);
    expect(approved.statusCode, approved.body).toBe(200);
    await waitFor(() => received.some((r) => r.body.includes(claimId)));
    const hit = received.find((r) => r.body.includes(claimId));
    expect(hit).toBeDefined();
    const event = JSON.parse(hit!.body);
    expect(event.type).toBe('claim.approved');
    expect(event.data.amount).toBe(450);
    expect(event.data.voucherNo).toBe(1);
    expect(verifySignature(secret, String(hit!.headers['x-hr-timestamp']), hit!.body, String(hit!.headers['x-hr-signature']))).toBe(true);
    expect(verifySignature('wrong-secret', String(hit!.headers['x-hr-timestamp']), hit!.body, String(hit!.headers['x-hr-signature']))).toBe(false);
  });

  it('accepts the ERP database\'s timestamps (+00:00) and keeps the payload the ERP reads', async () => {
    const since = '2026-01-01T00:00:00.123456+00:00';
    const res = await asErp(token, 'GET', `/api/integration/v1/claims?status=APPROVED&since=${encodeURIComponent(since)}`);
    expect(res.statusCode, res.body).toBe(200);
    const [claim] = res.json().claims;
    // The fields ERP migration 0095 (receive_hr_claim) reads. Renaming one breaks the ERP.
    for (const key of ['id', 'claimNo', 'voucherNo', 'status', 'type', 'typeLabel', 'title', 'amount', 'decidedAt', 'decidedBy', 'hasPhoto', 'hasDocument']) {
      expect(claim, key).toHaveProperty(key);
    }
    for (const key of ['id', 'code', 'name', 'branchId', 'branchName']) expect(claim.employee, key).toHaveProperty(key);
  });

  it('lets the ERP read approved claims — its own dealership only', async () => {
    await newClaim(OTHER.slug, 'Rival claim', 999);
    const res = await asErp(token, 'GET', '/api/integration/v1/claims?status=APPROVED');
    expect(res.statusCode, res.body).toBe(200);
    const claims = res.json().claims as { title: string }[];
    expect(claims.map((c) => c.title)).toEqual(['Fuel for PDI']);
  });

  it('keeps the ERP token off every other route, and people off the ERP routes', async () => {
    expect((await asErp(token, 'GET', '/api/admin/claims')).statusCode).toBe(403);
    expect((await asErp(token, 'GET', '/api/admin/employees')).statusCode).toBe(403);
    expect((await asErp(dealer[HOME.slug].token, 'GET', '/api/integration/v1/claims')).statusCode).toBe(403);
  });

  it('refuses paying at the counter what the ERP pays, and settles what the ERP paid', async () => {
    const [claim] = (await asErp(token, 'GET', '/api/integration/v1/claims?status=APPROVED')).json().claims;
    const counter = await asAdmin(HOME.slug, 'PATCH', `/api/admin/claims/${claim.id}/pay`);
    expect(counter.statusCode).toBe(409);

    const paid = await asErp(token, 'POST', `/api/integration/v1/claims/${claim.id}/paid`, { erpVoucherNo: 'PAY-2026-000007' });
    expect(paid.statusCode, paid.body).toBe(200);
    expect(paid.json().claim.status).toBe('PAID');

    const again = await asErp(token, 'POST', `/api/integration/v1/claims/${claim.id}/paid`, { erpVoucherNo: 'PAY-2026-000007' });
    expect(again.statusCode, 'a repeated report of the same payment is accepted').toBe(200);
    const other = await asErp(token, 'POST', `/api/integration/v1/claims/${claim.id}/paid`, { erpVoucherNo: 'PAY-2026-000099' });
    expect(other.statusCode, 'a second, different payment is refused').toBe(409);

    const reject = await asAdmin(HOME.slug, 'PATCH', `/api/admin/claims/${claim.id}/reject`, { note: 'changed my mind' });
    expect(reject.statusCode, 'a paid claim cannot be rejected').toBe(409);
  });

  it('announces an approved claim being taken back', async () => {
    const claimId = await newClaim(HOME.slug, 'Parcel charges', 120);
    await asAdmin(HOME.slug, 'PATCH', `/api/admin/claims/${claimId}/approve`);
    const rejected = await asAdmin(HOME.slug, 'PATCH', `/api/admin/claims/${claimId}/reject`, { note: 'Duplicate bill' });
    expect(rejected.statusCode, rejected.body).toBe(200);
    await waitFor(() => received.some((r) => r.body.includes(claimId) && r.body.includes('claim.changed')));
    const changed = received.find((r) => r.body.includes(claimId) && r.body.includes('claim.changed'));
    expect(JSON.parse(changed!.body).data.status).toBe('REJECTED');
  });

  it('gives the ERP people and attendance in its own shape', async () => {
    const employees = (await asErp(token, 'GET', '/api/integration/v1/employees')).json().employees;
    expect(employees).toHaveLength(1);
    expect(employees[0].id).toBe(dealer[HOME.slug].employeeId);
    const attendance = await asErp(token, 'GET', '/api/integration/v1/attendance?from=2026-09-01&to=2026-09-30');
    expect(attendance.statusCode, attendance.body).toBe(200);
    expect(Array.isArray(attendance.json())).toBe(true);
    expect((await asErp(token, 'GET', '/api/integration/v1/attendance?from=2026-01-01&to=2026-09-30')).statusCode).toBe(400);
  });

  it('stops an old key the moment the connection is rotated, and a switched-off one at once', async () => {
    const rotated = await asAdmin(HOME.slug, 'POST', `/api/admin/integrations/${clientId}/rotate`);
    expect(rotated.statusCode).toBe(200);
    expect((await asErp(token, 'GET', '/api/integration/v1/whoami')).statusCode).toBe(401);
    const fresh = rotated.json().token as string;
    expect(rotated.json().webhookSecret).not.toBe(secret);
    expect((await asErp(fresh, 'GET', '/api/integration/v1/whoami')).statusCode).toBe(200);

    await asAdmin(HOME.slug, 'PATCH', `/api/admin/integrations/${clientId}`, { isActive: false });
    expect((await asErp(fresh, 'GET', '/api/integration/v1/whoami')).statusCode).toBe(401);
  });
});
