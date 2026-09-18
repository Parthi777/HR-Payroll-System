# Addresses

One deployment, up to three addresses. Every part of this is off until the
variables below are set: unconfigured, the public page, Master Control and the
console are all served from one host, exactly as before.

```
yourdomain.com            the public page — a description and a way in
admin.yourdomain.com      Master Control — dealer staff, after signing in
platform.yourdomain.com   the platform console — you
```

**What separate addresses buy.** One address per audience: a client who lands on
the public page sees the page and a sign-in link, not the console. And a
separate browser origin per app, so a session token stored by one cannot be read
by script running on another.

**What they do not buy.** Master Control and the console both require a sign-in
wherever they are served from, so this is not what keeps anyone out. The
controls that refuse people are the two sign-ins, the console's two-step
verification, and `PLATFORM_ALLOWED_IPS` — see
[PLATFORM-CONSOLE-ACCESS.md](PLATFORM-CONSOLE-ACCESS.md).

---

## What each address serves

| Request | Public host | admin. | platform. |
|---|---|---|---|
| `/` | the public page | → `/login` | → `/platform` |
| `/login`, `/dashboard`, … | → `admin.` (same path) | serves it | → `/platform` |
| `/platform…` | 404 | 404 | serves it |

Old links keep working: a bookmarked `yourdomain.com/dashboard` redirects to
`admin.yourdomain.com/dashboard`. The routing lives in `web/src/proxy.ts`.

---

## Setting it up

1. **DNS.** Add a CNAME for `admin.yourdomain.com` and one for
   `platform.yourdomain.com`, both pointing at the web service's target
   (Railway → web service → Settings → Networking → Custom Domain), plus the
   bare domain itself. Add all three as custom domains on the web service.
2. **Web service variables:**
   ```
   NEXT_PUBLIC_ADMIN_HOST=admin.yourdomain.com
   NEXT_PUBLIC_PLATFORM_HOST=platform.yourdomain.com
   ```
   Both are read at build time, so Railway's redeploy after changing them is
   what applies them.
3. **Backend service variable:** `APP_BASE_DOMAIN=yourdomain.com`. This narrows
   CORS to that domain and its subdomains — without it the API answers any
   origin.
4. **Check:** `admin.yourdomain.com` shows the sign-in page,
   `yourdomain.com/platform/login` is a 404, and `platform.yourdomain.com` shows
   the console sign-in.

`admin` and `platform` are reserved words for workspace addresses, so no dealer
can ever be given a slug that collides with either.

---

## One address for every dealer: the workspace step

`admin.yourdomain.com` serves all dealers, so the address no longer says which
dealer someone belongs to. The sign-in page therefore asks first — "Which
workspace?" — and looks the name up before anyone types a password, so they can
see they are in the right place.

- It only asks when it has to. If the address already names a dealer
  (`bhavani.yourdomain.com`, or a `?tenant=bhavani-motors` link), or the browser
  remembers the last one, it goes straight to the password. On a deployment with
  exactly one dealer it never asks.
- The answer is remembered on that browser, and "Not <dealer>? Choose another
  workspace" under the sign-in button clears it.
- `GET /api/auth/workspace` is what the page asks: it answers yes or no, and
  never names a customer or says how many there are.
- Dealers who prefer their own address can still have one — a per-dealer
  subdomain (`bhavani.yourdomain.com`) works alongside the shared one and skips
  the question. That needs a wildcard DNS record and `APP_BASE_DOMAIN` set.

Give dealers a link with their workspace in it —
`https://admin.yourdomain.com/login?tenant=bhavani-motors` — and their first
sign-in skips the question too.
