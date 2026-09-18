# Platform console access

The platform console (`/platform`) creates, suspends and reads across every
dealer. Three things stand in front of it, from the outside in:

1. **Its own address** (optional) — `platform.yourdomain.com`, not a path on
   the address dealers use. Set up with the other two in
   [HOSTNAMES.md](HOSTNAMES.md); `admin.` is Master Control, not this.
2. **An office-IP allowlist** (optional) — every other address gets a 404.
3. **Password plus two-step verification** (always on).

The landing page no longer links to the console. Staff go to `/platform/login`
directly — bookmark it.

---

## Two-step verification

Mandatory for every console account. There is no setting to turn it off.

### What happens on the deploy that introduces it

- Every open console session ends at once. Sessions issued before two-step
  verification existed are refused, so nobody keeps a password-only session
  for its remaining 8 hours.
- Each account's **next sign-in** shows a QR code. Scan it with an authenticator
  app (Google Authenticator, Microsoft Authenticator, 1Password), enter the
  6-digit code, and save the ten recovery codes it shows. They are shown once.

**Sign in and enrol straight after deploying.** Until an account has enrolled,
its password alone is enough to enrol *an* authenticator — whoever gets there
first. The same is true after a colleague resets it (below).

### Losing your phone

In order of preference:

1. **A recovery code.** On the code screen, choose "Lost your phone? Use a
   recovery code". Each code works once; the activity log records every use.
   Replace your codes afterwards: My account → Replace recovery codes.
2. **A colleague resets it.** Team → Reset two-step on your row. Your next
   sign-in enrols a new phone. Nobody can reset their own.
3. **The script**, when you are the only administrator and the codes are gone
   too. Needs the production database URL:

   ```bash
   cd backend
   DATABASE_URL=<Railway DATABASE_PUBLIC_URL> \
     npx tsx scripts/reset-platform-two-step.ts --email you@yourco.com
   ```

   Then sign in and enrol immediately.

### Limits

- A code is accepted once. The same six digits cannot sign in twice.
- Five wrong codes lock that account's second step for 15 minutes, even for
  the right code, and the lock is recorded in the activity log. A lock means
  the password was correct, so if it was not you, change the password.
- Sign-in endpoints are also rate-limited per IP: 10 code attempts per
  10 minutes.

---

## Giving the console its own address

The code for this is in place and does nothing until configured. It needs a
domain you own; the Railway `*.up.railway.app` address cannot be split this way.

**What it gets you:** the console runs in its own browser origin, so its session
token sits in storage that a script on a dealer page cannot read. On a dealer's
address, `/platform` returns 404 and the console's sign-in page is never shown.

### Steps

The full three-address setup — DNS records, variables and what each address
serves — is in [HOSTNAMES.md](HOSTNAMES.md). For the console alone:

1. **DNS.** A CNAME for `platform.yourdomain.com` pointing at the web service,
   added as a custom domain on it. `platform` and `admin` are both reserved, so
   no dealer can ever claim either as a workspace address.
2. **Web service variable:** `NEXT_PUBLIC_PLATFORM_HOST=platform.yourdomain.com`.
   Read at build time, so Railway's redeploy after changing it is what applies it.
3. **Backend service variable:** `APP_BASE_DOMAIN=yourdomain.com`, if not set
   already. That narrows CORS to the domain and its subdomains.
4. **Check it:**
   - `https://platform.yourdomain.com/` redirects to `/platform`.
   - `https://<dealer address>/platform/login` is a 404.

Unset `NEXT_PUBLIC_PLATFORM_HOST` to go back: the console is served at
`/platform` on every address again.

---

## Restricting the console to office IPs

**Backend service variable:**

```
PLATFORM_ALLOWED_IPS=203.0.113.7, 198.51.100.0/24
```

Single addresses and CIDR ranges, IPv4 or IPv6, comma-separated. From any other
address, every `/api/platform/...` request gets the same 404 as a route that
does not exist, so the sign-in page loads but sign-in fails with "not found".

- **Check your office IP first** (for example, search "what is my IP" from the
  office network). If the office connection has a dynamic IP, it will change
  and lock everyone out until the variable is updated. Ask the ISP for a static
  IP before relying on this.
- **An invalid entry stops the backend from starting**, with the bad entry named
  in the deploy log. This is deliberate — a typo must not silently lock
  everyone out or let everyone in — but it takes the whole API down, dealers
  included, until the variable is fixed or removed. Copy the value carefully.
- **It depends on seeing the real client IP.** Railway's edge replaces
  `X-Forwarded-For` rather than appending to it (verified 2026-09-17 by sending
  a forged header and watching the rate-limit counter ignore it). If a CDN or
  proxy such as Cloudflare is put in front, the backend sees that proxy's
  address instead, and this allowlist must be revisited at the same time.
- It sits in front of the password and two-step verification, not instead of
  them: an office IP is shared by everyone in the office.

Unset the variable to allow any address again.
