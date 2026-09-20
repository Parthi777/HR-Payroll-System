import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { randomInt } from 'node:crypto';
import { requireKiosk, requireRole, type JwtPayload } from '../middleware/auth.js';
import { AppError } from '../utils/AppError.js';
import { env } from '../config/env.js';
import { runInTenant } from '../context/tenant-context.js';
import { resolveTenant } from '../context/tenant-resolve.js';
import { markCheckIn, markCheckOut } from '../services/attendance/attendance.service.js';
import { recordAudit } from '../services/audit/audit.service.js';
import {
  browserCredentials,
  createLivenessSession,
  isLivenessEnabled,
  livenessRegion,
  livenessResult,
} from '../services/ai/liveness.service.js';

/**
 * The branch kiosk — a tablet at the entrance that staff punch on.
 *
 * Two surfaces in one file: what an administrator does in Master Control
 * (create a kiosk, pair it, switch it off) and what the tablet itself does.
 *
 * The shape of the thing:
 *
 *   - A kiosk is *paired to one branch*. That pairing is the trust anchor: the
 *     punch uses the branch's own coordinates rather than asking a browser
 *     where it is, because a tablet screwed to a wall cannot be somewhere else
 *     and a browser's answer can be made up.
 *   - Staff type their employee code, then look at the camera. The code turns
 *     "who is this out of everyone?" into "is this that person?", which is the
 *     check the app already makes and the one that stays reliable as headcount
 *     grows.
 *   - Liveness comes from AWS, and the image the punch stores is the one AWS
 *     captured during the check it scored — not a frame the browser chose.
 *   - Nothing here is a new attendance rule. The punch goes through the same
 *     markCheckIn / markCheckOut as the app, so geofence, late, half day,
 *     approvals and WhatsApp behave identically.
 */
const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1
const PAIRING_LENGTH = 8;
const PAIRING_TTL_MINUTES = 30;

const pairSchema = z.object({
  workspace: z.string().trim().toLowerCase().min(2).max(31),
  code: z.string().trim().min(4).max(20),
});

const lookupSchema = z.object({ code: z.string().trim().min(1).max(40) });

const newKioskSchema = z.object({
  name: z.string().trim().min(1).max(80),
  branchId: z.string().min(1),
});

const updateKioskSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  isActive: z.boolean().optional(),
});

/** A code someone reads off a screen and types on a tablet. */
function newPairingCode(): string {
  let code = '';
  for (let i = 0; i < PAIRING_LENGTH; i++) code += PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

const normalise = (code: string) => code.toUpperCase().replace(/[\s-]/g, '');

export async function kioskRoutes(app: FastifyInstance) {
  /** What the tablet is told about itself. Never anything about other branches. */
  function deviceView(device: { id: string; name: string; branchId: string }, branchName: string) {
    return {
      device: { id: device.id, name: device.name },
      branch: { id: device.branchId, name: branchName },
      liveness: { enabled: isLivenessEnabled(), region: livenessRegion() },
    };
  }

  // ── The tablet ──

  /**
   * Pair a tablet: workspace address plus the one-time code from Master
   * Control. Unauthenticated by necessity — the tablet has nothing yet — so the
   * workspace is named explicitly rather than guessed, and the code is consumed
   * on use so it cannot pair a second device.
   */
  app.post('/kiosk/pair', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req) => {
    const { workspace, code } = pairSchema.parse(req.body);
    const tenant = await resolveTenant(app.prisma, workspace);

    return runInTenant({ tenantId: tenant.id, subjectId: 'kiosk-pairing', role: 'SUPER_ADMIN' }, async () => {
      const candidates = await app.prisma.kioskDevice.findMany({
        where: { isActive: true, pairingHash: { not: null } },
        include: { branch: { select: { name: true } } },
      });

      const now = new Date();
      let paired: (typeof candidates)[number] | undefined;
      for (const device of candidates) {
        if (!device.pairingHash) continue;
        if (device.pairingExpiresAt && device.pairingExpiresAt < now) continue;
        if (await bcrypt.compare(normalise(code), device.pairingHash)) {
          paired = device;
          break;
        }
      }
      // One message for a wrong code, an expired one and an unknown workspace:
      // a tablet in a showroom is somewhere a stranger can stand.
      if (!paired) throw AppError.unauthorized('That pairing code is not valid');

      const device = await app.prisma.kioskDevice.update({
        where: { id: paired.id },
        data: { pairingHash: null, pairingExpiresAt: null, pairedAt: now, lastSeenAt: now, tokenVersion: { increment: 1 } },
      });

      const token = app.jwt.sign(
        {
          sub: device.id,
          role: 'EMPLOYEE',
          scope: 'KIOSK' as const,
          tenantId: tenant.id,
          branchId: device.branchId,
          deviceVersion: device.tokenVersion,
        } satisfies JwtPayload,
        { expiresIn: `${env.KIOSK_TOKEN_DAYS}d` },
      );

      return { token, workspace: { slug: tenant.slug, name: tenant.name }, ...deviceView(device, paired.branch.name) };
    });
  });

  /** Who this tablet is, on every load. Also the heartbeat that shows it is alive. */
  app.get('/kiosk/session', { preHandler: requireKiosk }, async (req) => {
    const device = await app.prisma.kioskDevice.findUniqueOrThrow({
      where: { id: req.user.sub },
      include: { branch: { select: { name: true } } },
    });
    await app.prisma.kioskDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
    return deviceView(device, device.branch.name);
  });

  /**
   * Turn a typed employee code into a person, and say which way their next
   * punch goes.
   *
   * Only staff of this kiosk's own branch, and only active ones. The reply
   * carries a name so the person can see the tablet understood them, and
   * nothing else about them.
   */
  app.post('/kiosk/lookup', { preHandler: requireKiosk, config: { rateLimit: { max: 120, timeWindow: '10 minutes' } } }, async (req) => {
    const { code } = lookupSchema.parse(req.body);
    const employee = await findEmployee(req, code);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const attendance = await app.prisma.attendance.findUnique({
      where: { employeeId_date: { employeeId: employee.id, date: today } },
      select: { checkIn: true, checkOut: true },
    });
    const nextAction = attendance?.checkIn && !attendance.checkOut ? 'OUT' : 'IN';

    return {
      employee: { id: employee.id, name: employee.name, code: employee.employeeCode },
      nextAction,
      checkedInAt: attendance?.checkIn ?? null,
    };
  });

  /**
   * An employee of this kiosk's branch, by what they typed on the keypad.
   *
   * Employee codes are a dealer prefix and a number — EMP001 — and the keypad
   * has digits on it, because that is what a keypad by a workshop door should
   * have. So "1", "001" and "EMP001" all have to find the same person: the
   * exact code is tried first, then the number alone against every code's
   * digits. Two codes sharing a number (a dealer that has changed its prefix)
   * is refused rather than guessed, because marking the wrong person present is
   * worse than asking them to type the whole code.
   */
  async function findEmployee(req: FastifyRequest, code: string) {
    const typed = code.trim();
    let employee = await app.prisma.employee.findFirst({
      where: { employeeCode: { equals: typed, mode: 'insensitive' } },
      select: { id: true, name: true, employeeCode: true, branchId: true, status: true },
    });

    const digits = typed.replace(/\D/g, '');
    if (!employee && digits && digits === typed) {
      const number = parseInt(digits, 10);
      const atBranch = await app.prisma.employee.findMany({
        where: { branchId: req.user.branchId, status: 'ACTIVE' },
        select: { id: true, name: true, employeeCode: true, branchId: true, status: true },
      });
      const matches = atBranch.filter((e) => {
        const d = e.employeeCode.replace(/\D/g, '');
        return d !== '' && parseInt(d, 10) === number;
      });
      if (matches.length > 1) {
        throw new AppError('More than one person has that number — please type your full employee code', 409);
      }
      employee = matches[0] ?? null;
    }

    if (!employee) throw new AppError('That code does not match anyone here', 404);
    if (employee.status !== 'ACTIVE') throw new AppError('That account is not active — see HR', 403);
    // A kiosk stands in one branch and punches for the people who work there.
    if (employee.branchId !== req.user.branchId) {
      throw new AppError('You are not registered at this branch', 403);
    }
    return employee;
  }

  /**
   * Credentials and a session id for the liveness check the tablet runs
   * itself. Both are short-lived, and the session is good for one punch.
   */
  app.post(
    '/kiosk/liveness/session',
    { preHandler: requireKiosk, config: { rateLimit: { max: 120, timeWindow: '10 minutes' } } },
    async (req) => {
      if (!isLivenessEnabled()) throw new AppError('Liveness checking is not configured', 503);
      const device = await app.prisma.kioskDevice.findUniqueOrThrow({
        where: { id: req.user.sub },
        select: { name: true },
      });
      const [sessionId, credentials] = await Promise.all([
        createLivenessSession(),
        browserCredentials(device.name),
      ]);
      return { sessionId, credentials };
    },
  );

  /**
   * The punch itself.
   *
   * Multipart, like the app's check-in. `employeeId` is the person the code
   * resolved to, `livenessSessionId` the check they just passed. When liveness
   * is on, the selfie stored is the image AWS captured during that check and
   * any file the browser also sent is ignored — the browser does not get to
   * choose which frame is kept.
   */
  app.post(
    '/kiosk/punch',
    { preHandler: requireKiosk, config: { rateLimit: { max: 120, timeWindow: '10 minutes' } } },
    async (req) => {
      let uploaded: Buffer | null = null;
      let employeeId = '';
      let sessionId = '';
      for await (const part of req.parts()) {
        if (part.type === 'file') uploaded = await part.toBuffer();
        else if (part.fieldname === 'employeeId') employeeId = String(part.value);
        else if (part.fieldname === 'livenessSessionId') sessionId = String(part.value);
      }
      if (!employeeId) throw new AppError('Which employee is punching?', 400);

      const employee = await app.prisma.employee.findFirst({
        where: { id: employeeId },
        select: { id: true, name: true, employeeCode: true, branchId: true, status: true },
      });
      if (!employee) throw new AppError('That code does not match anyone here', 404);
      if (employee.status !== 'ACTIVE') throw new AppError('That account is not active — see HR', 403);
      if (employee.branchId !== req.user.branchId) {
        throw new AppError('You are not registered at this branch', 403);
      }

      let selfie: Buffer | null = uploaded;
      let liveness: { confidence: number; status: string } | null = null;

      if (isLivenessEnabled()) {
        if (!sessionId) throw new AppError('The camera check did not finish — please try again', 400);
        const outcome = await livenessResult(sessionId);
        liveness = { confidence: outcome.confidence, status: outcome.status };
        if (!outcome.live) {
          throw new AppError(
            'That did not look like a live person in front of the camera. Please try again, facing the screen.',
            403,
          );
        }
        if (!outcome.referenceImage) throw new AppError('The camera check returned no image — please try again', 502);
        selfie = outcome.referenceImage;
      }
      if (!selfie) throw new AppError('No photo was taken', 400);

      const branch = await app.prisma.branch.findUniqueOrThrow({
        where: { id: req.user.branchId as string },
        select: { geofenceLat: true, geofenceLng: true, name: true },
      });
      // A branch is provisioned with its location zeroed, to be drawn on the
      // map later. A kiosk punches at the branch's coordinates, so until that
      // is done there is nothing to punch at — and the message has to name the
      // real problem rather than the app's one about a phone's GPS.
      if (branch.geofenceLat === 0 && branch.geofenceLng === 0) {
        throw new AppError(
          `${branch.name} has no location set yet. Ask HR to place the branch on the map in Master Control, then try again.`,
          409,
        );
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const existing = await app.prisma.attendance.findUnique({
        where: { employeeId_date: { employeeId: employee.id, date: today } },
        select: { checkIn: true, checkOut: true },
      });
      const action: 'IN' | 'OUT' = existing?.checkIn && !existing.checkOut ? 'OUT' : 'IN';

      // As the employee, so the punch is recorded the way their own app would
      // have recorded it — same rules, same face gate, same approvals.
      const result = await runInTenant(
        { tenantId: req.user.tenantId as string, subjectId: employee.id, role: 'EMPLOYEE', branchId: employee.branchId },
        () =>
          action === 'IN'
            ? markCheckIn(app.prisma, employee.id, selfie, branch.geofenceLat, branch.geofenceLng)
            : markCheckOut(app.prisma, employee.id, selfie, branch.geofenceLat, branch.geofenceLng),
      );

      await app.prisma.kioskDevice.update({ where: { id: req.user.sub }, data: { lastSeenAt: new Date() } });

      return {
        action,
        employee: { name: employee.name, code: employee.employeeCode },
        branch: branch.name,
        liveness,
        ...result,
      };
    },
  );

  // ── Master Control ──
  //
  // Creating a kiosk hands out a code that pairs a tablet, so it is kept to the
  // roles that already decide who may work where.

  const adminGuard = requireRole('SUPER_ADMIN', 'HR_MANAGER');

  app.get('/admin/kiosks', { preHandler: adminGuard }, async () => {
    const kiosks = await app.prisma.kioskDevice.findMany({
      include: { branch: { select: { id: true, name: true, geofenceLat: true, geofenceLng: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return {
      kiosks: kiosks.map(({ pairingHash, pairingExpiresAt, ...k }) => ({
        ...k,
        // A kiosk at a branch with no map location cannot punch at all, so the
        // console says so before somebody carries a tablet to the showroom.
        branchLocationSet: !(k.branch.geofenceLat === 0 && k.branch.geofenceLng === 0),
        // Never the hash; only whether a code is currently outstanding.
        pairingPending: Boolean(pairingHash && (!pairingExpiresAt || pairingExpiresAt > new Date())),
      })),
      liveness: { enabled: isLivenessEnabled(), region: livenessRegion() },
    };
  });

  app.post('/admin/kiosks', { preHandler: adminGuard }, async (req, reply) => {
    const input = newKioskSchema.parse(req.body);
    const branch = await app.prisma.branch.findFirst({ where: { id: input.branchId }, select: { id: true, name: true } });
    if (!branch) throw AppError.notFound('Branch');

    const code = newPairingCode();
    const kiosk = await app.prisma.kioskDevice.create({
      data: {
        tenantId: req.user.tenantId as string,
        branchId: branch.id,
        name: input.name,
        pairingHash: await bcrypt.hash(normalise(code), 10),
        pairingExpiresAt: new Date(Date.now() + PAIRING_TTL_MINUTES * 60_000),
        createdById: req.user.sub,
      },
    });
    await recordAudit(req, 'KIOSK_CREATED', 'Kiosk', { entityId: kiosk.id, metadata: { name: kiosk.name, branch: branch.name } });

    // Shown once. It is stored as a hash, so a lost code is replaced, never read back.
    return reply.code(201).send({ kiosk: { ...kiosk, pairingHash: undefined }, pairingCode: code, expiresInMinutes: PAIRING_TTL_MINUTES });
  });

  /** A fresh code — for a replaced tablet, or one that was factory reset. */
  app.post('/admin/kiosks/:id/pairing-code', { preHandler: adminGuard }, async (req) => {
    const { id } = req.params as { id: string };
    const existing = await app.prisma.kioskDevice.findFirst({ where: { id }, select: { id: true, name: true } });
    if (!existing) throw AppError.notFound('Kiosk');

    const code = newPairingCode();
    await app.prisma.kioskDevice.update({
      where: { id },
      data: { pairingHash: await bcrypt.hash(normalise(code), 10), pairingExpiresAt: new Date(Date.now() + PAIRING_TTL_MINUTES * 60_000) },
    });
    await recordAudit(req, 'KIOSK_PAIRING_CODE_ISSUED', 'Kiosk', { entityId: id, metadata: { name: existing.name } });
    return { pairingCode: code, expiresInMinutes: PAIRING_TTL_MINUTES };
  });

  /**
   * Rename, or switch off. Switching off bumps the token version as well, so a
   * tablet that has been lost stops working on its next request rather than
   * when its token expires months from now.
   */
  app.patch('/admin/kiosks/:id', { preHandler: adminGuard }, async (req) => {
    const { id } = req.params as { id: string };
    const input = updateKioskSchema.parse(req.body);
    const existing = await app.prisma.kioskDevice.findFirst({ where: { id }, select: { id: true, name: true } });
    if (!existing) throw AppError.notFound('Kiosk');

    const kiosk = await app.prisma.kioskDevice.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.isActive !== undefined
          ? { isActive: input.isActive, ...(input.isActive ? {} : { tokenVersion: { increment: 1 } }) }
          : {}),
      },
    });
    if (input.isActive !== undefined) {
      await recordAudit(req, input.isActive ? 'KIOSK_ENABLED' : 'KIOSK_DISABLED', 'Kiosk', {
        entityId: id, metadata: { name: kiosk.name },
      });
    }
    return { kiosk: { ...kiosk, pairingHash: undefined } };
  });

  app.delete('/admin/kiosks/:id', { preHandler: adminGuard }, async (req) => {
    const { id } = req.params as { id: string };
    const existing = await app.prisma.kioskDevice.findFirst({ where: { id }, select: { id: true, name: true } });
    if (!existing) throw AppError.notFound('Kiosk');
    await app.prisma.kioskDevice.delete({ where: { id } });
    await recordAudit(req, 'KIOSK_DELETED', 'Kiosk', { entityId: id, metadata: { name: existing.name } });
    return { ok: true };
  });
}
