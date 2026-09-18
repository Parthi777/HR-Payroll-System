import { NextResponse, type NextRequest } from 'next/server';

/**
 * One deployment, up to three addresses.
 *
 *   yourdomain.com          the public page and nothing else
 *   admin.yourdomain.com    Master Control — dealer staff, after signing in
 *   platform.yourdomain.com the platform console — you
 *
 * Each host is set by its own variable (NEXT_PUBLIC_ADMIN_HOST,
 * NEXT_PUBLIC_PLATFORM_HOST) and everything here is off until they are, so an
 * unconfigured deployment serves every path on one host exactly as before.
 *
 * What this is and is not: Master Control and the console both require a
 * sign-in wherever they are served from, so separating the addresses is not
 * what keeps anyone out. What it buys is one address per audience — a client
 * who lands on the public page sees the page and a sign-in link, not the
 * console — and a separate browser origin per app, so a session token cannot
 * be read by script running on another of them. The controls that actually
 * refuse people are the sign-ins themselves, the console's two-step
 * verification, and PLATFORM_ALLOWED_IPS on the API.
 */
export function proxy(request: NextRequest) {
  const adminHost = process.env.NEXT_PUBLIC_ADMIN_HOST?.trim().toLowerCase();
  const platformHost = process.env.NEXT_PUBLIC_PLATFORM_HOST?.trim().toLowerCase();
  if (!adminHost && !platformHost) return NextResponse.next();

  const host = (request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '')
    .split(',')[0]
    .trim()
    .split(':')[0]
    .toLowerCase();
  const { pathname, search } = request.nextUrl;
  const isConsole = pathname === '/platform' || pathname.startsWith('/platform/');
  // The public site: the landing page and everything someone reads before they
  // have an account. These belong to the bare domain and are never redirected
  // to Master Control, which would send a prospect to a sign-in form.
  const isPublicSite =
    pathname === '/' ||
    ['/features', '/pricing', '/signup'].some((p) => pathname === p || pathname.startsWith(`${p}/`));

  // Built from the public host rather than request.url: behind the platform's
  // proxy the URL Next sees can name an internal address.
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0].trim()
    ?? request.nextUrl.protocol.replace(':', '');
  const sendTo = (target: string, path: string) => NextResponse.redirect(`${proto}://${target}${path}`);
  // Rendered as the app's ordinary not-found page, with a 404 status.
  const notHere = () => NextResponse.rewrite(new URL('/_not-served-here', request.url));

  if (platformHost && host === platformHost) {
    return isConsole ? NextResponse.next() : sendTo(platformHost, '/platform');
  }

  if (adminHost && host === adminHost) {
    // The console is a different product on a different address, never here.
    if (isConsole) return notHere();
    // Nobody opens the admin address to read the public site.
    return isPublicSite ? sendTo(adminHost, '/login') : NextResponse.next();
  }

  // Any other host is the public one.
  if (isConsole) return platformHost ? notHere() : NextResponse.next();
  if (!adminHost || isPublicSite) return NextResponse.next();
  // Old links and bookmarks still work: same path, on the address it now lives at.
  return sendTo(adminHost, `${pathname}${search}`);
}

export const config = {
  // Pages only: never static assets, or a host could not load its own scripts.
  matcher: ['/((?!_next/|favicon.ico|.*\\.[a-zA-Z0-9]+$).*)'],
};
