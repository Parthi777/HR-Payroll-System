import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../utils/AppError.js';
import { logger } from '../utils/logger.js';
import { PLANS, PLAN_CODES, planByCode } from '../services/subscription/plans.js';
import { markPaid, publicView } from '../services/subscription/subscription.service.js';
import {
  createOrder,
  razorpayConfigured,
  razorpayKeyId,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from '../services/subscription/razorpay.js';

const SLUG = /^[a-z0-9][a-z0-9-]{1,30}$/;
const RESERVED = new Set(['www', 'api', 'app', 'admin', 'platform', 'static', 'assets']);

const signupSchema = z.object({
  companyName: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().min(2).max(31),
  contactName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().min(6).max(20),
  staffCount: z.coerce.number().int().min(1).max(100_000).optional(),
  branchCount: z.coerce.number().int().min(1).max(1_000).optional(),
  planCode: z.enum(PLAN_CODES),
  note: z.string().trim().max(2_000).optional(),
});

const confirmSchema = z.object({
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  signature: z.string().min(1),
});

/**
 * Everything a prospective customer can reach without an account.
 *
 * Nothing here is authenticated, so each route is rate-limited and each one
 * answers as little as it can: plans and prices are public by definition, a
 * signup returns only its own reference, and the payment page is reachable
 * only through an unguessable token that names one subscription and nothing
 * else. No route here can read a dealer's data — none of these models carry
 * any.
 */
export async function publicRoutes(app: FastifyInstance) {
  /**
   * Keep the exact bytes for the Razorpay webhook's signature, the same way
   * the WhatsApp webhook does. Scoped to this plugin, so nothing else changes.
   */
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    (req as { rawBody?: Buffer }).rawBody = body as Buffer;
    try {
      done(null, JSON.parse((body as Buffer).toString('utf8') || '{}'));
    } catch {
      done(null, {});
    }
  });

  /** The plan table, as the server holds it. The site displays its own copy; this is the authority. */
  app.get('/public/plans', { config: { rateLimit: { max: 60, timeWindow: '10 minutes' } } }, async () => ({
    plans: PLANS,
    onlinePayment: razorpayConfigured(),
  }));

  /**
   * A dealership asking to join.
   *
   * Creates a request for review; it is not a workspace and grants nothing.
   * Rate-limited hard, because it is the one place a stranger can write to.
   */
  app.post('/public/signup', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
    const input = signupSchema.parse(req.body);

    if (!SLUG.test(input.slug) || RESERVED.has(input.slug)) {
      throw new AppError(
        `"${input.slug}" cannot be a workspace address. Use lowercase letters, digits and hyphens, e.g. "bhavani-motors".`,
        400,
      );
    }
    if (!planByCode(input.planCode)) throw new AppError('Choose a plan', 400);

    const taken = await app.prisma.tenant.findUnique({ where: { slug: input.slug } });
    if (taken) throw new AppError(`The address "${input.slug}" is already in use. Try another.`, 409);

    const pending = await app.prisma.signupRequest.findFirst({
      where: { status: 'PENDING', OR: [{ slug: input.slug }, { email: input.email }] },
    });
    if (pending) {
      throw new AppError(
        pending.email === input.email
          ? 'We already have a request from this email address and are reviewing it.'
          : `Someone has already asked for the address "${input.slug}".`,
        409,
      );
    }

    const created = await app.prisma.signupRequest.create({
      data: { ...input, status: 'PENDING' },
      select: { id: true, companyName: true, createdAt: true },
    });
    logger.info({ signupId: created.id }, 'signup request received');

    // The reference is what a person quotes on the phone; the id stays ours.
    return reply.code(201).send({
      reference: created.id.slice(-6).toUpperCase(),
      companyName: created.companyName,
    });
  });

  /** The subscription behind a payment link. The token is the only credential. */
  async function subscriptionFor(token: string) {
    const subscription = await app.prisma.subscription.findUnique({ where: { payToken: token } });
    if (!subscription) throw AppError.notFound('Payment link');
    const workspace = await app.prisma.tenant.findUnique({
      where: { id: subscription.workspaceId },
      select: { name: true, slug: true },
    });
    if (!workspace) throw AppError.notFound('Workspace');
    return { subscription, workspace };
  }

  app.get('/public/subscription/:token', { config: { rateLimit: { max: 60, timeWindow: '10 minutes' } } }, async (req) => {
    const { token } = req.params as { token: string };
    const { subscription, workspace } = await subscriptionFor(token);
    return {
      ...publicView(subscription, workspace.name),
      workspaceSlug: workspace.slug,
      onlinePayment: razorpayConfigured(),
      keyId: razorpayKeyId(),
    };
  });

  /**
   * An order to pay against, created at the amount held on the subscription —
   * never an amount the browser asked for. Reused if one already exists, so a
   * reloaded page does not litter the dashboard with orders.
   */
  app.post('/public/subscription/:token/order', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req) => {
    const { token } = req.params as { token: string };
    const { subscription, workspace } = await subscriptionFor(token);

    if (subscription.status === 'ACTIVE') throw new AppError('This subscription is already paid', 409);
    if (!razorpayConfigured()) throw new AppError('Online payment is not set up yet — we will confirm your payment by hand', 503);
    if (subscription.razorpayOrderId) {
      return { orderId: subscription.razorpayOrderId, amountPaise: subscription.amountPaise, keyId: razorpayKeyId() };
    }

    const order = await createOrder(subscription.amountPaise, `sub_${subscription.id}`, {
      workspace: workspace.slug,
      plan: subscription.planCode,
    });
    await app.prisma.subscription.update({
      where: { id: subscription.id },
      data: { razorpayOrderId: order.id },
    });
    return { orderId: order.id, amountPaise: subscription.amountPaise, keyId: razorpayKeyId() };
  });

  /**
   * What the browser reports after checkout.
   *
   * Trusted only because of the signature: HMAC of the order and payment ids
   * with the key secret, which only Razorpay and this server know. The webhook
   * below is the belt to this braces — whichever arrives first opens the
   * workspace, and the other is a no-op.
   */
  app.post('/public/subscription/:token/confirm', { config: { rateLimit: { max: 20, timeWindow: '10 minutes' } } }, async (req) => {
    const { token } = req.params as { token: string };
    const body = confirmSchema.parse(req.body);
    const { subscription, workspace } = await subscriptionFor(token);

    if (subscription.razorpayOrderId && subscription.razorpayOrderId !== body.razorpayOrderId) {
      throw new AppError('That payment belongs to another order', 400);
    }
    if (!verifyCheckoutSignature(body.razorpayOrderId, body.razorpayPaymentId, body.signature)) {
      throw AppError.forbidden('That payment could not be verified');
    }

    const { subscription: updated } = await markPaid(app.prisma, subscription, {
      razorpayPaymentId: body.razorpayPaymentId,
    });
    return publicView(updated, workspace.name);
  });

  /**
   * Razorpay's own notification, which is what makes payment reliable when the
   * customer closes the tab before the browser can confirm.
   *
   * Unauthenticated by necessity, so the signature is the whole gate: with no
   * webhook secret configured it refuses everything rather than trusting the
   * caller.
   */
  app.post('/public/razorpay/webhook', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
    const raw = (req as { rawBody?: Buffer }).rawBody ?? Buffer.from('');
    const signature = req.headers['x-razorpay-signature'];
    if (!verifyWebhookSignature(raw, Array.isArray(signature) ? signature[0] : signature)) {
      logger.warn('razorpay webhook rejected: bad or missing signature');
      throw AppError.forbidden('Invalid signature');
    }

    const body = req.body as {
      event?: string;
      payload?: { payment?: { entity?: { id?: string; order_id?: string } } };
    };
    const entity = body.payload?.payment?.entity;
    if (body.event !== 'payment.captured' || !entity?.order_id || !entity.id) {
      // Everything else is acknowledged and ignored: refusing unknown events
      // just makes Razorpay retry them.
      return reply.send({ ok: true, ignored: body.event ?? 'unknown' });
    }

    const subscription = await app.prisma.subscription.findUnique({
      where: { razorpayOrderId: entity.order_id },
    });
    if (!subscription) {
      logger.warn({ orderId: entity.order_id }, 'razorpay webhook for an order we do not have');
      return reply.send({ ok: true, ignored: 'unknown order' });
    }

    const { alreadyPaid } = await markPaid(app.prisma, subscription, { razorpayPaymentId: entity.id });
    logger.info({ workspaceId: subscription.workspaceId, alreadyPaid }, 'razorpay payment captured');
    return reply.send({ ok: true });
  });
}
