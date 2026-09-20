# Branch kiosk

A tablet by the door that staff punch on: they type their employee number, look
at the camera, and the day is marked. No phone, no app install, no personal
login on a shared device.

```
  Master Control → Kiosks → Add kiosk        an administrator creates it
     ↳ pairing code, shown once, 30 minutes
  tablet → /kiosk → workspace + code         the tablet pairs itself
  staff  → type number → look at camera      the punch
     ↳ liveness (AWS) → face match → markCheckIn / markCheckOut
```

Nothing about attendance changes. The punch runs through the same code as the
app, so geofence, late, half day, overtime, approvals and WhatsApp behave
exactly as they do for someone punching on their own phone.

---

## Setting one up

1. **Place the branch on the map** (Geofence), if it is not already. A kiosk
   punches at its branch's coordinates, so a branch with no location cannot be
   used — the kiosk page says so, and a punch is refused with that reason.
2. **Master Control → Kiosks → Add kiosk.** Name it after where it stands
   ("Reception tablet"), and choose its branch.
3. **Copy the pairing code.** It is shown once, works once, and expires after
   30 minutes. It is stored only as a hash, so a lost code is replaced, never
   read back.
4. **On the tablet**, open `/kiosk`, type the workspace address and the code.
5. Put the tablet in the operating system's own kiosk mode (Android: screen
   pinning; iPad: Guided Access) so staff cannot leave the page.

The tablet stays paired for six months by default (`KIOSK_TOKEN_DAYS`), and is
cut off the moment you switch it off in Master Control.

## What the tablet can and cannot do

A kiosk token is a device credential, not a person's session. It can:

- look up an employee **of its own branch** by code, and see their name;
- punch that employee in or out.

It cannot open anything else — not payroll, not employee records, not reports,
not another branch, not another dealership, and not the platform console. That
is enforced by its own token scope, checked on the server, and pinned in
`backend/tests/kiosk.test.ts`.

**Switching a tablet off** (Kiosks → Switch off) stops it on its *next request*
rather than when its token expires, because a lost tablet is the case that
matters. Issuing a new pairing code does the same to the old device.

## Identification: number, then face

Staff type their employee code. The keypad has digits on it, so the number
alone is enough — `1` and `001` both find `EMP001`. If two codes share a number,
the kiosk asks for the full code rather than guessing.

The typed code turns the question from "who is this, out of everyone?" into "is
this that person?" — the same 1:1 check the app makes, which stays reliable as
headcount grows. Matching a face against every employee would get less reliable
with every person hired.

A punch still requires an **enrolled face** and a match at or above the
dealership's threshold (85 by default). Enrol staff under Employees before
expecting them to use the kiosk.

## Liveness: what stops a photograph

A browser has no built-in way to tell a person from a photo of one. Two modes:

**`KIOSK_LIVENESS=aws` (default when AWS is configured).** AWS Rekognition Face
Liveness runs in the tablet's browser, streaming directly to AWS. The server
then asks AWS how it went, and takes the reference image from that result — so
the photo stored against the punch is one AWS captured during a check it scored,
not a frame the browser chose to send. It detects printed photos, screens and
masks.

What it needs:

- The IAM user in `AWS_ACCESS_KEY_ID` must be allowed
  `rekognition:CreateFaceLivenessSession`,
  `rekognition:GetFaceLivenessSessionResults`, `rekognition:StartFaceLivenessSession`
  and `sts:GetFederationToken`.
- `AWS_LIVENESS_REGION` if Face Liveness is not offered in `AWS_REGION` —
  **check AWS's current region list**, and note the liveness region does not
  have to match the face collection's; the image comes back and is matched
  against the collection in `AWS_REGION`.
- `KIOSK_LIVENESS_THRESHOLD` (default 80, which is AWS's own guidance).
- It is billed per check. Confirm the current rate before putting a busy
  entrance on it.

The tablet never holds your AWS keys. It is given federated credentials that
allow exactly one action, for fifteen minutes, minted per check.

**`KIOSK_LIVENESS=off`.** The tablet takes a plain photo. The face match still
stops a colleague punching for someone, but a printed photo of that colleague
would pass. Only sensible where the tablet is in someone's line of sight — the
Kiosks page says so in as many words, so nobody assumes otherwise.

## What it does not do

- **No offline punches.** Face matching and liveness are cloud calls; with no
  connection the tablet cannot punch. Staff use the app, or HR raises a manual
  punch.
- **No liveness in the fallback mode**, as above.
- **It asserts its own location.** A kiosk punches at its branch's coordinates
  because a wall-mounted tablet cannot be somewhere else. Somebody who unpairs a
  tablet, carries it away and re-pairs it with a fresh code has moved the
  "location" with it — which is why issuing codes is limited to Super Admin and
  HR Manager, and every code and switch-off is in the activity log.
- **No enrolment from the kiosk.** Faces are enrolled in Master Control.

## Configuration

```env
KIOSK_LIVENESS=aws              # aws | off
AWS_LIVENESS_REGION=            # only if AWS_REGION has no Face Liveness
KIOSK_LIVENESS_THRESHOLD=80
KIOSK_TOKEN_DAYS=180
```

## Where it lives

| Piece | File |
|---|---|
| Device model | `KioskDevice` in `backend/prisma/schema.prisma` |
| Pairing, lookup, punch, admin screens | `backend/src/routes/kiosk.routes.ts` |
| Device guard | `requireKiosk` in `backend/src/middleware/auth.ts` |
| Liveness (sessions, results, browser credentials) | `backend/src/services/ai/liveness.service.ts` |
| Tablet UI | `web/src/app/kiosk/page.tsx` |
| Liveness / camera components | `web/src/components/kiosk/` |
| Master Control screen | `web/src/app/(dashboard)/kiosks/page.tsx` |
| Tests | `backend/tests/kiosk.test.ts`, `web/e2e/kiosk.spec.ts` |
