/**
 * A dealership's subscription: created when its signup is approved, and the
 * thing that decides whether its workspace is open.
 *
 * The workspace is provisioned suspended and opens when the subscription is
 * paid. That ordering is deliberate — approving a signup should not hand out a
 * working system, and paying should not require a person to remember to flip a
 * switch afterwards.
 *
 * Money is held in paise and taken from the server's plan table, never from a
 * request. Every transition is recorded by the caller in the platform log.
 */
import { randomBytes } from 'node:crypto';
import type { PrismaClient, Subscription } from '@prisma/client';
import { AppError } from '../../utils/AppError.js';
import { env } from '../../config/env.js';
import { amountPaise, planByCode } from './plans.js';

export type SubscriptionStatus = 'PENDING_PAYMENT' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED';

/** One month from a given moment, which is how long a paid period lasts. */
function monthFrom(start: Date): Date {
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  return end;
}

/** The link a new dealership follows to pay. Unguessable, and it carries no session. */
export function paymentUrl(payToken: string): string {
  const base = env.PUBLIC_SITE_URL?.replace(/\/$/, '');
  return base ? `${base}/signup/pay/${payToken}` : `/signup/pay/${payToken}`;
}

/**
 * Start a subscription for a freshly provisioned workspace, at the plan's
 * current price. Idempotent per workspace: a second call returns the existing
 * row rather than issuing a second payment link.
 */
export async function startSubscription(
  prisma: PrismaClient,
  workspaceId: string,
  planCode: string,
): Promise<Subscription> {
  const plan = planByCode(planCode);
  if (!plan) throw new AppError(`"${planCode}" is not a plan`, 400);

  const existing = await prisma.subscription.findUnique({ where: { workspaceId } });
  if (existing) return existing;

  return prisma.subscription.create({
    data: {
      workspaceId,
      planCode: plan.code,
      amountPaise: amountPaise(plan),
      status: 'PENDING_PAYMENT',
      payToken: randomBytes(24).toString('base64url'),
    },
  });
}

/**
 * Record a payment and open the workspace.
 *
 * Idempotent: Razorpay may deliver a webhook more than once, and the browser
 * confirms the same payment in parallel. The first call through wins and the
 * rest are no-ops that return the same state, rather than extending the paid
 * period twice.
 *
 * `paidById` names a platform user when a person recorded the payment instead
 * of a gateway; `razorpayPaymentId` names the payment when a gateway did.
 */
export async function markPaid(
  prisma: PrismaClient,
  subscription: Subscription,
  by: { razorpayPaymentId?: string; paidById?: string },
): Promise<{ subscription: Subscription; alreadyPaid: boolean }> {
  if (subscription.status === 'ACTIVE' && subscription.paidAt) {
    return { subscription, alreadyPaid: true };
  }

  const paidAt = new Date();
  // Conditional on the row still being unpaid, so two callers racing cannot
  // both believe they were the one that opened the workspace.
  const { count } = await prisma.subscription.updateMany({
    where: { id: subscription.id, status: 'PENDING_PAYMENT' },
    data: {
      status: 'ACTIVE',
      paidAt,
      periodEnd: monthFrom(paidAt),
      razorpayPaymentId: by.razorpayPaymentId ?? null,
      paidById: by.paidById ?? null,
    },
  });

  const updated = await prisma.subscription.findUniqueOrThrow({ where: { id: subscription.id } });
  if (count === 1) {
    // The workspace was provisioned suspended; this is what opens it.
    await prisma.tenant.update({ where: { id: updated.workspaceId }, data: { status: 'ACTIVE' } });
  }
  return { subscription: updated, alreadyPaid: count !== 1 };
}

/** What the payment page may know: never the ids, never another dealership. */
export function publicView(subscription: Subscription, workspaceName: string) {
  const plan = planByCode(subscription.planCode);
  return {
    company: workspaceName,
    planCode: subscription.planCode,
    planName: plan?.name ?? subscription.planCode,
    amountPaise: subscription.amountPaise,
    status: subscription.status as SubscriptionStatus,
    paidAt: subscription.paidAt,
    periodEnd: subscription.periodEnd,
  };
}
