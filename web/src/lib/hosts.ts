/**
 * Where each part of the product lives.
 *
 * Master Control can be given its own address (NEXT_PUBLIC_ADMIN_HOST, e.g.
 * "admin.yourdomain.com"), leaving the public page on the bare domain. When it
 * is not set, everything is served from one host and these are plain paths.
 *
 * Always absolute when the variable is set — including on the admin host
 * itself, where a relative path would do. Branching on the current hostname
 * would make the server and the browser render different links and break
 * hydration, which costs more than the extra characters.
 */
export function masterControlHref(path = '/'): string {
  const host = process.env.NEXT_PUBLIC_ADMIN_HOST?.trim().toLowerCase();
  return host ? `https://${host}${path}` : path;
}
