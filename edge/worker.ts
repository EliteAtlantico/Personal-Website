// The Worker: the one part of the site that isn't a file. It answers
// /api/visitor, what Cloudflare can see of a visitor's connection (their city
// and network, and whether they're in the EU), for personalizing the paper
// (src/signals). Nothing is stored; it's the visitor's own information, handed
// back to their browser.
//
// Everything else is dist/, which Cloudflare serves straight from its edge
// without running this (wrangler.jsonc sends it only /api/*), with the
// security headers from dist/_headers (server/headers.ts). Those requests
// don't count against the Workers free plan's daily limit either, so if
// someone used the limit up, only the personalizing would stop.

import { HSTS, SECURITY } from '../server/headers'

/** The parts of Cloudflare's request.cf the site uses. */
export interface Cf {
  city?: string
  region?: string
  country?: string
  asOrganization?: string
  isEUCountry?: string
}

export default {
  async fetch(request: Request & { cf?: Cf }): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') return json({}, 405, { allow: 'GET, HEAD' })
    if (new URL(request.url).pathname === '/api/visitor') return visitor(request.cf)
    return json({}, 404)
  },
}

function visitor(cf: Cf = {}) {
  return json({ city: cf.city, region: cf.region, country: cf.country, org: cf.asOrganization, eu: cf.isEUCountry === '1' }, 200, { 'cache-control': 'private, no-store' })
}

function json(body: unknown, status: number, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...SECURITY, 'strict-transport-security': HSTS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  })
}
