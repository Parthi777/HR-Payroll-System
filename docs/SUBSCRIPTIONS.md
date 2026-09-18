# Signup and subscriptions

A dealership can now ask for a workspace itself, from the public site. Nothing
it does creates access: a signup is a request, you approve it, and paying is
what opens the workspace.

```
  /signup            →  SignupRequest (PENDING)      the client asks
  platform console   →  approve                      you decide
     ↳ provisions the workspace SUSPENDED
     ↳ starts a Subscription (PENDING_PAYMENT)
     ↳ issues an unguessable payment link
  /signup/pay/<token> →  payment                     the client pays
     ↳ Razorpay, verified by signature — or you record it by hand
     ↳ workspace ACTIVE, the administrator can sign in
```

## What each side sees

**The client:** a form (dealership, workspace address, contact, plan), then a
reference number and a plain list of what happens next. Later, a payment page
showing the plan, the amount and — once paid — a link to sign in.

**You:** Platform console → **Signups**. Pending requests with everything they
told you; Approve opens a short form (address, administrator name and email, a
generated password) and then shows the payment link and credentials **once**.
Approved rows show `Awaiting ₹…` until payment lands, and carry two actions:
copy the payment link, or **Mark as paid**.

## Prices

Tiers live in two places, and are meant to agree:

- `backend/src/services/subscription/plans.ts` — **the authority.** The amount
  charged is read from here, never from the browser.
- `web/src/lib/plans.ts` — what the pricing page and signup form display.

The figures shipped (₹1,499 / ₹3,999 / ₹7,999 per month, excluding GST) are
**placeholders**. Change both files before taking a real payment.

## Turning on card payment

Unset, everything above still works — the payment page says you will take
payment directly, and **Mark as paid** opens the workspace. To accept cards,
UPI and netbanking:

1. Create a Razorpay account and complete their KYC.
2. Start in **Test mode**. Settings → API Keys → generate a key id and secret.
3. Set on the backend service:
   ```
   RAZORPAY_KEY_ID=rzp_test_xxxxxxxx
   RAZORPAY_KEY_SECRET=xxxxxxxx
   PUBLIC_SITE_URL=https://yourdomain.com     # so payment links are absolute
   ```
4. Add a webhook in the Razorpay dashboard pointing at
   `https://<your API host>/api/public/razorpay/webhook`, subscribed to
   **payment.captured**, with a secret of your choosing. Set the same value as
   `RAZORPAY_WEBHOOK_SECRET`.
5. Test end to end with Razorpay's test cards, then swap the three values for
   live keys.

**Both halves are verified.** The browser's result is checked against
Razorpay's signature (HMAC of the order and payment ids with your key secret)
and the webhook against its own secret — with no webhook secret configured, the
webhook refuses every call rather than trusting it. Whichever arrives first
opens the workspace; the other is a no-op, so a customer closing the tab
mid-payment still gets their workspace, and a Razorpay retry never charges or
extends anything twice.

Card details never reach this system: the card form is Razorpay's, in their
own frame.

## What this does not do yet

Be clear-eyed about the gaps before selling against them:

- **No renewals.** The first month is taken; `periodEnd` is recorded and
  nothing acts on it. No invoice goes out, nothing charges a second month, and
  nothing suspends a workspace that stops paying. Suspending is manual, from
  the dealers page.
- **No emails.** Approving a signup does not notify the client — you send the
  payment link and credentials yourself (the console gives you both to copy).
- **No self-serve plan changes.** Moving a dealership between tiers is a
  database change today.
- **No refunds or proration** of any kind.
- **GST** is handled by Razorpay's tax settings and your invoicing, not here.
- **No enforcement of plan limits.** A Starter workspace is not stopped at 25
  employees; the limit is a sales promise, not a control.

## Where it lives

| Piece | File |
|---|---|
| Plans (authority) | `backend/src/services/subscription/plans.ts` |
| Subscription state, idempotent payment | `backend/src/services/subscription/subscription.service.ts` |
| Razorpay orders and both signatures | `backend/src/services/subscription/razorpay.ts` |
| Public routes (signup, pay, webhook) | `backend/src/routes/public.routes.ts` |
| Approval and mark-paid | `backend/src/routes/platform.routes.ts` |
| Signup form / payment page | `web/src/app/signup/` |
| Console review screen | `web/src/app/platform/signups/page.tsx` |
| Tests | `backend/tests/signup.test.ts`, `web/e2e/signup.spec.ts` |
