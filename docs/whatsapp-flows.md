# WhatsApp

Outbound alerts and inbound commands, over Twilio or Meta. One provider is
active at a time, chosen by `WHATSAPP_PROVIDER`.

Nothing here needs code changes to switch: the provider decides which credentials
are read, which signature scheme guards the webhook, and which payload shape is
parsed. Everything after a message is understood is the same code either way.

---

## Setting up Twilio

### 1. Credentials

From the Twilio console (Account → API keys & tokens, and Messaging → Senders →
WhatsApp senders):

```env
WHATSAPP_PROVIDER=twilio
TWILIO_ACCOUNT_SID=AC…
TWILIO_AUTH_TOKEN=…                      # also signs inbound webhooks
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
```

`TWILIO_AUTH_TOKEN` does double duty: it authenticates outbound sends *and* is
the key Twilio signs inbound requests with. There is no separate webhook secret,
unlike Meta.

Set these on the backend service. Until they are all present `isWhatsAppEnabled()`
is false: messages are still written to `WhatsAppLog` with status `QUEUED`, so
the admin screen shows what *would* have gone out, and delivery starts the moment
the credentials exist. Nothing needs redeploying to "turn on".

### 2. Point Twilio at the webhook

Messaging → Senders → your WhatsApp sender → **"When a message comes in"**:

```
https://<your-backend-host>/api/whatsapp/webhook     (HTTP POST)
```

Only needed for inbound commands. If you are only sending alerts, skip it — the
webhook stays refused-by-default and nothing breaks.

### 3. If signatures fail

Twilio signs **the URL it called plus every POST parameter**, not the body. The
URL has to match byte for byte, and behind a proxy the host and scheme the app
sees are the internal ones. That is the usual cause of every request being
rejected with `Bad signature`.

The fix is to state the URL rather than derive it:

```env
WHATSAPP_WEBHOOK_URL=https://<your-backend-host>/api/whatsapp/webhook
```

Set it to exactly what is in the Twilio console, query string included.

---

## Setting up Meta Cloud API

```env
WHATSAPP_PROVIDER=meta
META_WHATSAPP_TOKEN=…
META_WHATSAPP_PHONE_ID=…
META_WHATSAPP_VERIFY_TOKEN=…     # you invent this; Meta echoes it back once
META_WHATSAPP_APP_SECRET=…       # App → Settings → Basic → App secret
```

Webhook URL is the same. Meta first calls it with `GET` carrying
`hub.verify_token`, which must equal `META_WHATSAPP_VERIFY_TOKEN`; the route
echoes `hub.challenge` back. Afterwards it `POST`s signed JSON.

`META_WHATSAPP_APP_SECRET` is separate from the access token and is easy to miss.
Without it the webhook answers `503` to everything rather than trusting unsigned
input.

---

## How an inbound message is trusted

The webhook is unauthenticated by necessity — it is a URL a third party calls —
so three things stand in for a session (`services/whatsapp/inbound.service.ts`):

**1. The signature.**

| | Twilio | Meta |
|---|---|---|
| Header | `X-Twilio-Signature` | `X-Hub-Signature-256` |
| Signs | URL + params sorted by name | the raw request body |
| Algorithm | HMAC-SHA1, base64 | HMAC-SHA256, hex |
| Key | `TWILIO_AUTH_TOKEN` | `META_WHATSAPP_APP_SECRET` |

Both are compared in constant time. Both refuse everything when their key is
unset — a webhook that skips the check when unconfigured is worse than one that
does not exist.

**2. Whose employee sent it.** `Employee.phone` is unique *per tenant*, so on a
shared number one phone can be on two dealers' payrolls. `resolveInbound`
refuses an ambiguous number instead of picking one — answering `STATUS` for the
wrong dealer would hand over a stranger's attendance, and `SLIP` their salary. A
dealer on their own WhatsApp number is unambiguous: the receiving number
identifies them whatever the sender's number collides with.

**3. Scope.** Every command runs inside `runInTenant` as that employee, so a
caller who never signed in still reaches only their own rows.

An unrecognised number gets **silence**, not "no such employee" — a reply either
way would confirm which numbers are registered.

---

## Commands

| Sent | Answered with |
|---|---|
| `STATUS` | today's check-in, check-out and status |
| `BALANCE` | casual leave used and remaining, this year |
| `SLIP` | latest payslip month and net figure |
| `LEAVE` | how to apply in the app |
| `IN` / `OUT` | that attendance needs a selfie, so it happens in the app |
| anything else | the list above |

Payslip PDFs are never attached. The PDF is served over an authenticated route,
and the message arrives with no sign-in behind it.

Replies to a recognised sender are written to that dealer's `WhatsAppLog`, so
the conversation sits beside every other message that employee was sent. A reply
to an ambiguous number is sent but logged nowhere — there is no workspace it
belongs to.

---

## Outbound triggers

`dispatchWhatsApp()` logs every message to `WhatsAppLog` and then sends. Wired
today: leave approved, leave rejected, and inbound replies. Check-in and
check-out confirmations have templates in `waTemplates` and are not yet wired to
the punch routes.

Sends are currently synchronous. CLAUDE.md calls for BullMQ, which needs a Redis
instance that is not yet provisioned; `dispatchWhatsApp` never throws, so a
provider outage marks the log row `FAILED` rather than failing the request that
triggered it.

---

## Known gaps

- **No queue.** See above — needs Redis.
- **Per-dealer accounts are not honoured.** `TenantSettings.whatsappMode`
  (`SHARED` / `OWN`) and `whatsappConfig` are read into the policy object and
  nothing acts on them, so a dealer set to `OWN` still sends on the platform's
  number. Until that is wired, `OWN` is a stored intention, not a behaviour.
- **`send-slips` is a stub**, returning `{ queued: 0, status: 'TODO' }`.
- **Templates are not registered with the provider.** Both Meta and Twilio
  require business-initiated messages to use pre-approved templates outside the
  24-hour service window; `waTemplates` composes free text, which is fine for
  replies and for alerts inside the window, and will be rejected outside it.
