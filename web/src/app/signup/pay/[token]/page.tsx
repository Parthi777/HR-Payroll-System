'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Script from 'next/script';
import { Building2, Check, Clock, Loader2, ShieldCheck } from 'lucide-react';
import { publicApi, type RazorpayOrder, type SubscriptionView } from '@/lib/public-api';
import { masterControlHref } from '@/lib/hosts';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';

/** Just enough of Razorpay's checkout global to open it and hear back. */
interface RazorpayResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}
interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  handler: (r: RazorpayResponse) => void;
  prefill?: { name?: string; email?: string; contact?: string };
  theme?: { color?: string };
  modal?: { ondismiss?: () => void };
}
declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => { open: () => void };
  }
}

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN')}`;

/**
 * The payment page, opened from a link rather than a login.
 *
 * The token in the URL is the only credential, and it names one subscription:
 * it cannot read a dealership's data, because there is none behind it. The
 * amount is whatever the server says — this page displays it and never sends
 * one back.
 */
export default function PayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [subscription, setSubscription] = useState<SubscriptionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkoutReady, setCheckoutReady] = useState(false);

  const load = useCallback(async () => {
    try {
      setSubscription(await publicApi.get<SubscriptionView>(`/subscription/${token}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That payment link is not valid');
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  async function pay() {
    if (!subscription) return;
    setBusy(true);
    setError(null);
    try {
      const order = await publicApi.post<RazorpayOrder>(`/subscription/${token}/order`);
      if (!window.Razorpay || !order.keyId) throw new Error('The payment window could not be opened. Please try again.');

      const checkout = new window.Razorpay({
        key: order.keyId,
        amount: order.amountPaise,
        currency: 'INR',
        name: 'HR & Payroll',
        description: `${subscription.planName} plan — ${subscription.company}`,
        order_id: order.orderId,
        theme: { color: '#5b4fc4' },
        modal: { ondismiss: () => setBusy(false) },
        handler: async (response) => {
          try {
            // Verified server-side against Razorpay's signature. The webhook
            // does the same independently, so closing this tab mid-payment
            // still opens the workspace.
            setSubscription(
              await publicApi.post<SubscriptionView>(`/subscription/${token}/confirm`, {
                razorpayOrderId: response.razorpay_order_id,
                razorpayPaymentId: response.razorpay_payment_id,
                signature: response.razorpay_signature,
              }),
            );
          } catch (err) {
            setError(
              err instanceof Error
                ? `${err.message} If money has left your account, tell us — the payment is recorded either way.`
                : 'Payment could not be confirmed',
            );
            void load();
          } finally {
            setBusy(false);
          }
        },
      });
      checkout.open();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the payment');
      setBusy(false);
    }
  }

  const paid = subscription?.status === 'ACTIVE';

  return (
    <main className="min-h-screen bg-background">
      {subscription?.onlinePayment && (
        <Script src="https://checkout.razorpay.com/v1/checkout.js" onReady={() => setCheckoutReady(true)} />
      )}

      <section className="brand-gradient px-6 pb-16 pt-8 text-white sm:px-10">
        <div className="mx-auto max-w-2xl">
          <SiteHeader />
          <div className="py-12">
            <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
              {paid ? 'Your workspace is open.' : 'One payment, and you are in.'}
            </h1>
            <p className="mt-3 text-base leading-relaxed text-white/80">
              {paid
                ? 'This subscription is paid and the workspace is active.'
                : 'Your request was approved. Paying the first month opens your workspace.'}
            </p>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-2xl px-6 py-12 sm:px-10">
        {error && !subscription && (
          <p role="alert" className="rounded-2xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {!subscription && !error && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your subscription…
          </div>
        )}

        {subscription && (
          <div className="space-y-6">
            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="flex items-start gap-3">
                <Building2 className="mt-0.5 h-5 w-5 text-muted-foreground" />
                <div>
                  <div className="text-lg font-bold">{subscription.company}</div>
                  <div className="text-sm text-muted-foreground">
                    Workspace address <span className="font-mono">{subscription.workspaceSlug}</span>
                  </div>
                </div>
              </div>

              <dl className="mt-6 space-y-3 border-t border-border pt-5 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Plan</dt>
                  <dd className="font-semibold">{subscription.planName}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">First month</dt>
                  <dd className="font-semibold">{rupees(subscription.amountPaise)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">GST</dt>
                  <dd className="text-muted-foreground">added at checkout</dd>
                </div>
                {subscription.periodEnd && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Paid until</dt>
                    <dd className="font-semibold">
                      {new Date(subscription.periodEnd).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </dd>
                  </div>
                )}
              </dl>
            </div>

            {error && subscription && (
              <p role="alert" className="rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                {error}
              </p>
            )}

            {paid ? (
              <div className="rounded-2xl border-2 border-emerald-500/40 bg-emerald-50 p-6">
                <div className="flex items-center gap-2 text-emerald-900">
                  <Check className="h-5 w-5" />
                  <h2 className="font-bold">Paid</h2>
                </div>
                <p className="mt-2 text-sm text-emerald-900/90">
                  Your workspace is open. Sign in with the administrator email you gave us — we have sent
                  the password separately.
                </p>
                <Link
                  href={masterControlHref(`/login?tenant=${subscription.workspaceSlug}`)}
                  className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white"
                >
                  Go to sign in
                </Link>
              </div>
            ) : subscription.onlinePayment ? (
              <>
                <button
                  type="button"
                  onClick={pay}
                  disabled={busy || !checkoutReady}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl brand-gradient text-sm font-semibold text-white shadow-brand transition hover:brightness-110 disabled:opacity-60"
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  {busy ? 'Opening payment…' : `Pay ${rupees(subscription.amountPaise)}`}
                </button>
                <p className="flex items-start gap-2 text-xs text-muted-foreground">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                  Payment is handled by Razorpay — UPI, cards and netbanking. Card details never reach
                  this site, and every payment is verified against Razorpay&rsquo;s own signature before
                  your workspace opens.
                </p>
              </>
            ) : (
              <div className="flex gap-3 rounded-2xl border border-border bg-secondary/50 p-6">
                <Clock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="text-sm">
                  <div className="font-semibold">We will take payment directly</div>
                  <p className="mt-1 leading-relaxed text-muted-foreground">
                    Card payment is not switched on yet. We will contact you with bank transfer or UPI
                    details, and open your workspace as soon as the payment lands. This page will show
                    it as paid.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <SiteFooter />
    </main>
  );
}
