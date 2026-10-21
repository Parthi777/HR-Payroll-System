/**
 * "Forgot password?" on Master Control: an emailed one-time link.
 *
 * Pins that the answer never confirms an address, that the link works once,
 * only in its own workspace and only until it expires, and that a reset does
 * not get anyone past two-step verification.
 *
 * Needs a database (see tests/isolation.test.ts); skips without one.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import bcrypt from 'bcrypt';
import type { FastifyInstance } from 'fastify';
import { platformSignIn } from './support/platform-session.js';
import { adminSignIn } from './support/admin-session.js';
import { setMailForTests, type Mail } from '../src/services/mail/mail.service.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const suite = TEST_DATABASE_URL ? describe : describe.skip;

const PLATFORM = { email: 'owner@platform.test', name: 'Platform Owner', password: 'platform-owner-pass' };
const PASSWORD = 'dealer-admin-password';
const OWNER = 'owner@reset.test';
const SLUG = 'reset-motors';
const OTHER_SLUG = 'other-motors';
const APP_URL = 'https://hr.example.test';

suite('resetting a Master Control password by email', () => {
  let app: FastifyInstance;
  const sent: Mail[] = [];

  let ipCounter = 0;
  const freshIp = () => `10.13.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;
  const post = (url: string, payload: object, slug = SLUG) =>
    app.inject({ method: 'POST', url, remoteAddress: freshIp(), headers: { 'x-tenant-slug': slug }, payload });
  const forgot = (email: string, slug = SLUG) => post('/api/auth/admin/forgot-password', { email }, slug);
  const reset = (token: string, password: string, slug = SLUG) =>
    post('/api/auth/admin/reset-password', { token, password }, slug);
  /** The token out of the last email's link. */
  const lastToken = () => {
    const link = sent.at(-1)!.text.match(/https:\/\/\S+/)![0];
    const url = new URL(link);
    expect(url.origin).toBe(APP_URL);
    expect(url.pathname).toBe('/reset-password');
    expect(url.searchParams.get('workspace')).toBe(SLUG);
    return url.searchParams.get('token')!;
  };
  // The mail is sent after the response; let it land.
  const settle = () => new Promise((r) => setTimeout(r, 20));

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
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
    for (const slug of [SLUG, OTHER_SLUG]) {
      const made = await app.inject({
        method: 'POST', url: '/api/platform/tenants', remoteAddress: freshIp(),
        headers: { authorization: `Bearer ${platformToken}` },
        // The same person administers both, as one owner of two dealerships would.
        payload: { slug, name: slug, admin: { name: 'Owner', email: OWNER, password: PASSWORD } },
      });
      expect(made.statusCode, made.body).toBe(201);
    }
    // Two-step set up, as every real account is after its first sign-in.
    expect((await adminSignIn(app, { slug: SLUG, email: OWNER, password: PASSWORD }, freshIp)).statusCode).toBe(200);
  }, 120_000);

  afterAll(async () => {
    setMailForTests(null);
    await app?.close();
  });

  it('says to ask a Super Admin while email is not set up', async () => {
    setMailForTests(null);
    const res = await forgot(OWNER);
    expect(res.statusCode).toBe(503);
    expect(res.json().message).toMatch(/Super Admin/);
  });

  it('answers the same for an address with no login, and sends nothing', async () => {
    setMailForTests({ send: async (m) => { sent.push(m); }, adminAppUrl: APP_URL });
    const known = await forgot(OWNER.toUpperCase());
    const unknown = await forgot('nobody@reset.test');
    expect(known.statusCode).toBe(200);
    expect(unknown.statusCode).toBe(200);
    expect(Object.keys(unknown.json())).toEqual(Object.keys(known.json()));
    await settle();
    expect(sent.map((m) => m.to)).toEqual([OWNER]);
  });

  it('sets a new password with the link, once', async () => {
    await forgot(OWNER);
    await settle();
    const token = lastToken();

    expect((await reset(token, 'short')).statusCode).toBe(422);
    // A link issued at one dealer is nothing at another, even for the same person.
    expect((await reset(token, 'new-password-from-mail', OTHER_SLUG)).statusCode).toBe(400);

    const done = await reset(token, 'new-password-from-mail');
    expect(done.statusCode, done.body).toBe(200);
    expect((await reset(token, 'another-password-here')).statusCode).toBe(400);

    expect((await adminSignIn(app, { slug: SLUG, email: OWNER, password: PASSWORD }, freshIp)).statusCode).toBe(401);
    // The other dealer's login, same address, is untouched.
    expect((await adminSignIn(app, { slug: OTHER_SLUG, email: OWNER, password: PASSWORD }, freshIp)).statusCode).toBe(200);
  });

  it('still asks for the authenticator code after a reset', async () => {
    const login = await post('/api/auth/admin/login', { email: OWNER, password: 'new-password-from-mail' });
    expect(login.statusCode, login.body).toBe(200);
    expect(login.json().step).toBe('verify');
    expect(login.json().token).toBeUndefined();
  });

  it('refuses a link once it has expired', async () => {
    await forgot(OWNER);
    await settle();
    const token = lastToken();
    const { runUnscoped } = await import('../src/context/tenant-context.js');
    await runUnscoped('test: expire the link', () =>
      app.prisma.adminUser.updateMany({ where: { email: OWNER }, data: { resetLinkExpiresAt: new Date(Date.now() - 1000) } }),
    );
    expect((await reset(token, 'too-late-password')).statusCode).toBe(400);
  });

  it('keeps only the hash of the link', async () => {
    await forgot(OWNER);
    await settle();
    const token = lastToken();
    const { runUnscoped } = await import('../src/context/tenant-context.js');
    const rows = await runUnscoped('test: read the stored hash', () =>
      app.prisma.adminUser.findMany({ where: { email: OWNER }, select: { resetLinkHash: true } }),
    );
    expect(rows.some((r) => r.resetLinkHash)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain(token);
  });
});
