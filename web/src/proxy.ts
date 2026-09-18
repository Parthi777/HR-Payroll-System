import { NextResponse, type NextRequest } from 'next/server';

/**
 * The platform console on its own address.
 *
 * Off until NEXT_PUBLIC_PLATFORM_HOST is set (e.g. "admin.yourapp.com"). Once
 * it is:
 *
 *   - on that host, everything that is not the console redirects to /platform,
 *     so the address means one thing;
 *   - on every other host, /platform is a 404 — a dealer's address does not
 *     even show the console's sign-in page.
 *
 * None of this is what protects the console. The page is JavaScript anyone can
 * download; the API's two-step sign-in and PLATFORM_ALLOWED_IPS are the
 * controls. What a separate host does buy is a separate browser origin, so the
 * console's token lives in storage that script on a dealer page cannot read.
 */
export function proxy(request: NextRequest) {
  const platformHost = process.env.NEXT_PUBLIC_PLATFORM_HOST?.trim().toLowerCase();
  if (!platformHost) return NextResponse.next();

  const host = (request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '')
    .split(',')[0]
    .trim()
    .split(':')[0]
    .toLowerCase();
  const { pathname } = request.nextUrl;
  const isConsole = pathname === '/platform' || pathname.startsWith('/platform/');

  if (host === platformHost) {
    if (isConsole) return NextResponse.next();
    // Built from the public host, not request.url: behind the platform's proxy
    // the URL Next sees can name an internal address.
    const proto = request.headers.get('x-forwarded-proto')?.split(',')[0].trim() ?? request.nextUrl.protocol.replace(':', '');
    return NextResponse.redirect(`${proto}://${platformHost}/platform`);
  }

  if (isConsole) {
    // Rendered as the app's ordinary not-found page, with a 404 status.
    return NextResponse.rewrite(new URL('/_console-not-here', request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Pages only: never static assets, or the console host could not load its
  // own scripts after the redirect.
  matcher: ['/((?!_next/|favicon.ico|.*\\.[a-zA-Z0-9]+$).*)'],
};
