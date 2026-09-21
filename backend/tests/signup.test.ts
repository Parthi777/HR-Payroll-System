/**
 * Self-serve signup, end to end: a stranger asks, the platform approves, the
 * workspace stays shut until it is paid for, and then it opens.
 *
 * The things worth pinning here are the ones that cost money or let someone in
 * early: an approved-but-unpaid workspace must refuse its own administrator, a
 * payment must be provable rather than merely claimed, and the amount must come
 * from the server's plan table whatever the browser says.
 *
 * Needs a database (see tests/isolation.test.ts); skips without one.
 */
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import type { FastifyInstance } from 'fastify';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const suite = TEST_DATABASE_URL ? describe : describe.skip;

// Set before the server is imported: config/env.ts reads the environment once,
// at import time. Without this the webhook would have no secret and would
// (correctly) refuse everything, including the test's own valid signature.
const WEBHOOK_SECRET = 'test-razorpay-webhook-secret';
process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;

const PLATFORM = { email: 'owner@platform.test', name: 'Platform Owner', password: 'platform-owner-pass' };
const DEALER_ADMIN_PASSWORD = 'new-dealer-admin-password';

const APPLICANT = {
  companyName: 'Sunrise Motors',
  slug: 'sunrise-motors',
  contactName: 'Anita Rao',
  email: 'anita@sunrisemotors.test',
  phone: '+919000012345',
  staffCount: 40,
  branchCount: 2,
  planCode: 'GROWTH' as const,
  note: 'Two showrooms, one workshop.',
};

/** The Growth plan, in paise, as backend/src/services/subscription/plans.ts holds it. */
const GROWTH_PAISE = 3999 * 100;

suite('signing up without being invited', () => {
  let app: FastifyInstance;
  let platformToken: string;

  let ipCounter = 0;
  const freshIp = () => `10.4.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

  const post = (url: string, payload?: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method: 'POST', url, remoteAddress: freshIp(), headers, ...(payload === undefined ? {} : { payload: payload as object }) });

  const asPlatform = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: unknown) =>
    app.inject({
      method, url, remoteAddress: freshIp(),
      headers: { authorization: `Bearer ${platformToken}` },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const { buildServer } = await import('../src/server.js');
    const { platformSignIn } = await import('./support/platform-session.js');
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
    await p.subscription.deleteMany({});
    await p.signupRequest.deleteMany({});
    await p.platformAuditLog.deleteMany({});
    await p.tenant.deleteMany({});
    await p.platformUser.deleteMany({});

    await p.platformUser.create({
      data: { email: PLATFORM.email, name: PLATFORM.name, passwordHash: await bcrypt.hash(PLATFORM.password, 4) },
    });
    platformToken = await platformSignIn(app, PLATFORM, freshIp);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  describe('the public plan list', () => {
    it('is readable by anyone, and says whether cards are accepted', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/public/plans', remoteAddress: freshIp() });
      expect(res.statusCode, res.body).toBe(200);
      const { plans, onlinePayment } = res.json() as { plans: { code: string; priceMonthly: number }[]; onlinePayment: boolean };
      expect(plans.map((p) => p.code)).toEqual(['STARTER', 'GROWTH', 'ENTERPRISE']);
      expect(plans.find((p) => p.code === 'GROWTH')?.priceMonthly).toBe(GROWTH_PAISE / 100);
      // No Razorpay key in the test environment, so the fallback path is on.
      expect(onlinePayment).toBe(false);
    });
  });

  describe('asking to join', () => {
    let reference: string;

    it('refuses an address that could never be a subdomain, or that is reserved', async () => {
      for (const slug of ['Sunrise Motors', 'admin', 'x']) {
        const res = await post('/api/public/signup', { ...APPLICANT, slug });
        expect([400, 422], `slug ${slug}: ${res.body}`).toContain(res.statusCode);
      }
    });

    it('refuses a plan that does not exist', async () => {
      const res = await post('/api/public/signup', { ...APPLICANT, planCode: 'FREE_FOREVER' });
      expect(res.statusCode).toBe(422);
    });

    it('takes the request, and answers with a reference and nothing else', async () => {
      const res = await post('/api/public/signup', APPLICANT);
      expect(res.statusCode, res.body).toBe(201);
      const body = res.json();
      reference = body.reference;
      expect(reference).toHaveLength(6);
      expect(body.companyName).toBe(APPLICANT.companyName);
      // A stranger learns nothing else — no id, no status, no workspace.
      expect(Object.keys(body).sort()).toEqual(['companyName', 'reference']);
    });

    it('creates nothing a workspace could be mistaken for', async () => {
      expect(await app.prisma.tenant.findUnique({ where: { slug: APPLICANT.slug } })).toBeNull();
      const signup = await app.prisma.signupRequest.findFirst({ where: { email: APPLICANT.email } });
      expect(signup?.status).toBe('PENDING');
    });

    it('refuses a second request for the same address or the same email', async () => {
      const sameSlug = await post('/api/public/signup', { ...APPLICANT, email: 'someone@else.test' });
      expect(sameSlug.statusCode).toBe(409);
      const sameEmail = await post('/api/public/signup', { ...APPLICANT, slug: 'another-address' });
      expect(sameEmail.statusCode).toBe(409);
    });

    it('is listed for review, with its reference', async () => {
      const res = await asPlatform('GET', '/api/platform/signups?status=PENDING');
      expect(res.statusCode, res.body).toBe(200);
      const { signups, pending } = res.json() as { signups: { reference: string; companyName: string }[]; pending: number };
      expect(pending).toBe(1);
      expect(signups[0].reference).toBe(reference);
      expect(signups[0].companyName).toBe(APPLICANT.companyName);
    });

    it('is not readable with a dealer’s sign-in, or none at all', async () => {
      const anonymous = await app.inject({ method: 'GET', url: '/api/platform/signups', remoteAddress: freshIp() });
      expect(anonymous.statusCode).toBe(401);
    });
  });

  describe('approving one', () => {
    let signupId: string;
    let payToken: string;
    let workspaceId: string;

    const dealerLogin = () =>
      app.inject({
        method: 'POST', url: '/api/auth/admin/login', remoteAddress: freshIp(),
        headers: { 'x-tenant-slug': APPLICANT.slug },
        payload: { email: APPLICANT.email, password: DEALER_ADMIN_PASSWORD },
      });

    beforeAll(async () => {
      const signup = await app.prisma.signupRequest.findFirstOrThrow({ where: { email: APPLICANT.email } });
      signupId = signup.id;
    });

    it('refuses a weak administrator password', async () => {
      const res = await asPlatform('PATCH', `/api/platform/signups/${signupId}/approve`, { password: 'short' });
      expect(res.statusCode).toBe(422);
    });

    it('provisions the workspace shut, with a subscription to pay', async () => {
      const res = await asPlatform('PATCH', `/api/platform/signups/${signupId}/approve`, { password: DEALER_ADMIN_PASSWORD });
      expect(res.statusCode, res.body).toBe(200);

      const { tenant, subscription } = res.json();
      workspaceId = tenant.id;
      expect(tenant.slug).toBe(APPLICANT.slug);
      expect(subscription.status).toBe('PENDING_PAYMENT');
      // The price is the server's, for the plan they asked for.
      expect(subscription.planCode).toBe('GROWTH');
      expect(subscription.amountPaise).toBe(GROWTH_PAISE);
      expect(subscription.paymentUrl).toContain('/signup/pay/');

      payToken = subscription.paymentUrl.split('/signup/pay/')[1];
      expect(payToken.length).toBeGreaterThan(20);

      const row = await app.prisma.tenant.findUniqueOrThrow({ where: { id: workspaceId } });
      expect(row.status, 'an unpaid workspace was opened').toBe('SUSPENDED');
    });

    it('does not let its administrator in before it is paid for', async () => {
      const res = await dealerLogin();
      expect(res.statusCode).toBe(403);
      expect(res.json().message).toMatch(/suspended/i);
    });

    it('cannot be approved twice', async () => {
      const res = await asPlatform('PATCH', `/api/platform/signups/${signupId}/approve`, { password: DEALER_ADMIN_PASSWORD });
      expect(res.statusCode).toBe(409);
    });

    describe('the payment page', () => {
      it('shows the plan and the amount to whoever holds the link', async () => {
        const res = await app.inject({ method: 'GET', url: `/api/public/subscription/${payToken}`, remoteAddress: freshIp() });
        expect(res.statusCode, res.body).toBe(200);
        const body = res.json();
        expect(body.company).toBe(APPLICANT.companyName);
        expect(body.amountPaise).toBe(GROWTH_PAISE);
        expect(body.status).toBe('PENDING_PAYMENT');
      });

      it('is a 404 for a token nobody issued', async () => {
        const res = await app.inject({ method: 'GET', url: '/api/public/subscription/not-a-real-token', remoteAddress: freshIp() });
        expect(res.statusCode).toBe(404);
      });

      it('says so plainly when cards are not set up, rather than half-starting a payment', async () => {
        const res = await post(`/api/public/subscription/${payToken}/order`);
        expect(res.statusCode).toBe(503);
      });

      it('refuses a payment that is merely claimed', async () => {
        const res = await post(`/api/public/subscription/${payToken}/confirm`, {
          razorpayOrderId: 'order_faked',
          razorpayPaymentId: 'pay_faked',
          signature: 'not-a-signature',
        });
        expect(res.statusCode).toBe(403);
        const row = await app.prisma.subscription.findUniqueOrThrow({ where: { workspaceId } });
        expect(row.status).toBe('PENDING_PAYMENT');
      });
    });

    describe('the Razorpay webhook', () => {
      const signed = (body: object) => ({
        payload: body,
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': createHmac('sha256', WEBHOOK_SECRET).update(JSON.stringify(body)).digest('hex'),
        },
      });

      it('refuses an unsigned call, and one signed with the wrong secret', async () => {
        const body = { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1' } } } };
        const unsigned = await app.inject({
          method: 'POST', url: '/api/public/razorpay/webhook', remoteAddress: freshIp(),
          headers: { 'content-type': 'application/json' }, payload: body,
        });
        expect(unsigned.statusCode).toBe(403);

        const wrong = await app.inject({
          method: 'POST', url: '/api/public/razorpay/webhook', remoteAddress: freshIp(),
          headers: {
            'content-type': 'application/json',
            'x-razorpay-signature': createHmac('sha256', 'the-wrong-secret').update(JSON.stringify(body)).digest('hex'),
          },
          payload: body,
        });
        expect(wrong.statusCode).toBe(403);
      });

      it('opens the workspace when a payment for its order is captured — once, however many times it arrives', async () => {
        // The order id is set when the page asks for one; with no gateway
        // configured in tests, stand it in directly.
        await app.prisma.subscription.update({ where: { workspaceId }, data: { razorpayOrderId: 'order_live_1' } });
        const body = {
          event: 'payment.captured',
          payload: { payment: { entity: { id: 'pay_live_1', order_id: 'order_live_1' } } },
        };

        const first = await app.inject({ method: 'POST', url: '/api/public/razorpay/webhook', remoteAddress: freshIp(), ...signed(body) });
        expect(first.statusCode, first.body).toBe(200);

        const paid = await app.prisma.subscription.findUniqueOrThrow({ where: { workspaceId } });
        expect(paid.status).toBe('ACTIVE');
        expect(paid.razorpayPaymentId).toBe('pay_live_1');
        expect(paid.periodEnd!.getTime()).toBeGreaterThan(paid.paidAt!.getTime());

        // Razorpay retries; a retry must not extend the period a second time.
        const again = await app.inject({ method: 'POST', url: '/api/public/razorpay/webhook', remoteAddress: freshIp(), ...signed(body) });
        expect(again.statusCode).toBe(200);
        const after = await app.prisma.subscription.findUniqueOrThrow({ where: { workspaceId } });
        expect(after.paidAt!.toISOString()).toBe(paid.paidAt!.toISOString());
        expect(after.periodEnd!.toISOString()).toBe(paid.periodEnd!.toISOString());
      });

      it('ignores an event for an order that is not ours', async () => {
        const body = { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_x', order_id: 'order_someone_else' } } } };
        const res = await app.inject({ method: 'POST', url: '/api/public/razorpay/webhook', remoteAddress: freshIp(), ...signed(body) });
        expect(res.statusCode).toBe(200);
        expect(res.json().ignored).toBe('unknown order');
      });
    });

    it('lets the administrator in once it is paid for', async () => {
      const res = await dealerLogin();
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().tenant.slug).toBe(APPLICANT.slug);
    });

    it('records the approval, and the payment, in the platform log', async () => {
      const res = await asPlatform('GET', '/api/platform/audit');
      const actions = (res.json().entries as { action: string }[]).map((e) => e.action);
      expect(actions).toContain('SIGNUP_APPROVED');
      expect(actions).toContain('TENANT_CREATED');
      expect(JSON.stringify(res.json()), 'a password reached the log').not.toContain(DEALER_ADMIN_PASSWORD);
    });
  });

  describe('a payment taken outside the gateway', () => {
    const OTHER = { ...APPLICANT, companyName: 'Kovai Cars', slug: 'kovai-cars', email: 'ops@kovai.test', planCode: 'STARTER' as const };
    let workspaceId: string;

    it('opens the workspace and names who recorded it', async () => {
      expect((await post('/api/public/signup', OTHER)).statusCode).toBe(201);
      const signup = await app.prisma.signupRequest.findFirstOrThrow({ where: { email: OTHER.email } });

      const approved = await asPlatform('PATCH', `/api/platform/signups/${signup.id}/approve`, { password: DEALER_ADMIN_PASSWORD });
      expect(approved.statusCode, approved.body).toBe(200);
      workspaceId = approved.json().tenant.id;
      expect(approved.json().subscription.amountPaise).toBe(1499 * 100);

      const paid = await asPlatform('PATCH', `/api/platform/subscriptions/${workspaceId}/mark-paid`);
      expect(paid.statusCode, paid.body).toBe(200);
      expect(paid.json().subscription.status).toBe('ACTIVE');

      const me = await asPlatform('GET', '/api/platform/me');
      expect(paid.json().subscription.paidById).toBe(me.json().id);
      expect((await app.prisma.tenant.findUniqueOrThrow({ where: { id: workspaceId } })).status).toBe('ACTIVE');
    });

    it('is a no-op the second time, rather than a second month', async () => {
      const again = await asPlatform('PATCH', `/api/platform/subscriptions/${workspaceId}/mark-paid`);
      expect(again.statusCode).toBe(200);
      expect(again.json().alreadyPaid).toBe(true);
    });
  });

  describe('rejecting one', () => {
    it('records the reason, and creates no workspace', async () => {
      const applicant = { ...APPLICANT, companyName: 'Nope Motors', slug: 'nope-motors', email: 'no@nope.test' };
      expect((await post('/api/public/signup', applicant)).statusCode).toBe(201);
      const signup = await app.prisma.signupRequest.findFirstOrThrow({ where: { email: applicant.email } });

      const res = await asPlatform('PATCH', `/api/platform/signups/${signup.id}/reject`, { reason: 'Duplicate of an existing customer' });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().signup.status).toBe('REJECTED');
      expect(res.json().signup.reviewNote).toBe('Duplicate of an existing customer');
      expect(await app.prisma.tenant.findUnique({ where: { slug: applicant.slug } })).toBeNull();

      const log = await asPlatform('GET', '/api/platform/audit?action=SIGNUP_REJECTED');
      expect((log.json().entries as unknown[]).length).toBe(1);
    });

    it('cannot then be approved', async () => {
      const signup = await app.prisma.signupRequest.findFirstOrThrow({ where: { email: 'no@nope.test' } });
      const res = await asPlatform('PATCH', `/api/platform/signups/${signup.id}/approve`, { password: DEALER_ADMIN_PASSWORD });
      expect(res.statusCode).toBe(409);
    });
  });
});
