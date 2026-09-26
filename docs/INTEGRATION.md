# Accounting ERP integration

The dealer's accounting ERP (a separate app) books and pays approved claims, and reads people, attendance and payroll. Code: `backend/src/services/integration/`, `backend/src/routes/integration.routes.ts`, and the Master Control page `web/src/app/(dashboard)/integrations`. Test: `backend/tests/integration.test.ts`.

## Connecting

Master Control → **Accounting ERP** → **Connect** (SUPER_ADMIN only).

- **Key and webhook secret.** Shown once. Paste them into the ERP as `HR_API_KEY` and `HR_WEBHOOK_SECRET`.
  - The key is a JWT with scope `INTEGRATION`, checked against its `IntegrationClient` row on every call, so **New key** and **Switch off** stop the ERP at once.
  - The webhook secret is derived from the server secret, the client id and the token version. It is never stored.
- **ERP pays approved claims** (on by default). "Mark Paid" here is refused with 409; the claim shows PAID when the ERP pays it from its cash book.

## Out: announcements

Approving a claim writes an `IntegrationEvent` of type `claim.approved`. Taking an approved claim back writes one of type `claim.changed`.

- **Signing.** Each event is POSTed to the webhook with these headers:
  - `x-hr-timestamp`
  - `x-hr-signature: sha256=HMAC(secret, "<timestamp>.<body>")`
  - `x-hr-event-id`
- **Retries.** Delivery starts right away. Failures are retried by a sweep once a minute, with backoff, for about 12 attempts.
- **Why nothing is lost.** The ERP also pulls approved claims, so an event that never arrives costs a delay, not a claim.

A paid claim can no longer be approved, rejected or sent back from here: its money is in a cash book.

## In: `/api/integration/v1` (integration token only)

| Route | Returns |
|---|---|
| `GET /whoami` | Workspace and connection |
| `GET /branches` | Branches |
| `GET /employees?since=` | People (the id is the stable reference the ERP stores) |
| `GET /claims?status=A,B&since=` | Claim payloads, oldest change first |
| `GET /claims/:id/file?which=photo\|pdf` | The receipt file |
| `POST /claims/:id/paid {erpVoucherNo, paidAt}` | Marks the claim PAID. Idempotent for the same voucher; a different voucher is refused with 409. |
| `GET /attendance?from=&to=` | Day records in the shape of the ERP's `AttendanceRecord`, at most 3 months per call |
| `GET /payroll/:year/:month` | Payslip lines and whether the month is finalised |

Timestamps accept either `Z` or `+00:00`.
