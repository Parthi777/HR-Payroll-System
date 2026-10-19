# Signing in — who gets which login, and two-step verification

Every login in a dealer's workspace is **issued by an administrator**. Nobody
signs themselves up, and there is no "Sign in with Google".

| Who | Signs in with | Issued by |
|---|---|---|
| Employee (app) | **User ID** — their employee code (`EMP001`) or phone number — and a password | Super Admin when adding them (or bulk import); a Super Admin **or HR Manager** can issue a new password at any time (Employees → Password) |
| Admin / manager (web, and the app's Admin tab) | Email + password + **a 6-digit code from an authenticator app** | Super Admin, at User Access → Add Admin |
| A dealer's first Super Admin | The same | The platform console, when the workspace is created |

A new employee password is shown **once**, on the screen of whoever issued it;
only a hash is stored. Hand it over in person or by a private message.

## Two-step verification (every admin and manager)

It is not optional, for any role — Super Admin, HR Manager, Branch Manager,
Payroll Admin or Cashier. A password on its own opens nothing.

**First sign-in.** After the password, the page says *Set up two-step
verification*:

1. Install an authenticator app on your phone — Google Authenticator, Microsoft
   Authenticator, 1Password; any of them works.
2. On the web, scan the QR code. In the Android app, tap **Add to authenticator
   app** (or type the key it shows).
3. Type the 6-digit code the app shows, then **save the 10 recovery codes**
   somewhere that is not your phone. They are shown once.

**Every sign-in after that:** password, then the current 6-digit code from the
app. Each code works once and lasts 30 seconds. Five wrong codes lock the second
step for 15 minutes.

**Lost or replaced phone:**

- Sign in with one of your recovery codes (*Lost your phone? Use a recovery
  code*). Each works once. Then ask a Super Admin to reset your two-step.
- A Super Admin resets a colleague's from **User Access** (the ↺ button next to
  their name). They set it up again with the new phone at their next sign-in. You
  cannot reset your own.
- Running low on recovery codes? **User Access → Your two-step verification →
  Replace recovery codes** (needs a code from the app).
- The dealer's **only** Super Admin has lost both the phone and the recovery
  codes: the platform owner resets it from the console
  (`DELETE /api/platform/tenants/:id/admins/:adminId/two-step`).

Every set-up, reset, lock-out and recovery-code sign-in is written to the
workspace's activity log.

## For developers

- Logic: `backend/src/services/auth/two-step.service.ts` (shared with the
  platform console, account kind `'admin'` / `'platform'`), routes in
  `backend/src/routes/auth.routes.ts` and `admin-two-step.routes.ts`.
- `authenticate()` refuses any admin-role token without `twoStep: true`, so the
  release that introduced this signed every admin out once.
- Tests: `backend/tests/sign-in.test.ts`; browser: `web/e2e/dealer-app.spec.ts`.
- The platform console's own two-step: `docs/PLATFORM-CONSOLE-ACCESS.md`.
