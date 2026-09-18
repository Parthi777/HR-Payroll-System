/**
 * Who may reach the platform API at all, by network address.
 *
 * Off unless PLATFORM_ALLOWED_IPS is set. When it is, a request to any
 * /api/platform route from another address gets the same 404 as a route that
 * does not exist — the console is not merely refused from elsewhere, it is not
 * there. This sits in front of the password and the second step, not instead of
 * them: an office IP is shared by everyone in the office.
 *
 * It depends on `req.ip` being the real client. On Railway it is — the edge
 * replaces X-Forwarded-For rather than appending to it, checked by sending a
 * forged header and watching the rate-limit counter ignore it. Put another
 * proxy in front (Cloudflare, say) and `req.ip` becomes that proxy's address,
 * so the allowlist has to be revisited with it.
 */
import { BlockList, isIP } from 'node:net';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Parse "203.0.113.7, 198.51.100.0/24, 2001:db8::/48". Returns null when unset
 * or blank. Throws on an entry it cannot read, so a typo stops the deploy
 * instead of quietly shutting everyone out — or quietly letting everyone in.
 */
export function parseAllowList(raw: string | undefined): BlockList | null {
  const entries = (raw ?? '').split(',').map((e) => e.trim()).filter(Boolean);
  if (entries.length === 0) return null;

  const list = new BlockList();
  for (const entry of entries) {
    const [address, prefixText] = entry.split('/');
    const family = isIP(address);
    if (family === 0) throw new Error(`PLATFORM_ALLOWED_IPS: "${entry}" is not an IP address or range`);
    const type = family === 4 ? 'ipv4' : 'ipv6';

    if (prefixText === undefined) {
      list.addAddress(address, type);
      continue;
    }
    const prefix = Number(prefixText);
    const max = family === 4 ? 32 : 128;
    if (!/^\d+$/.test(prefixText) || prefix < 0 || prefix > max) {
      throw new Error(`PLATFORM_ALLOWED_IPS: "${entry}" has an invalid range size`);
    }
    list.addSubnet(address, prefix, type);
  }
  return list;
}

export function isAllowed(list: BlockList, ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) return false;
  // BlockList matches an IPv4-mapped IPv6 address (::ffff:203.0.113.7)
  // against IPv4 rules, so a dual-stack listener needs no special case.
  return list.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

/** An onRequest hook that makes the routes it guards invisible to other addresses. */
export function platformAccessHook(list: BlockList) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (isAllowed(list, req.ip)) return;
    req.log.warn({ ip: req.ip, url: req.url }, 'platform API request from an address not on the allowlist');
    return reply.callNotFound();
  };
}
