// The front door, on Cloudflare's edge.
//
// It answers /api/visitor itself: what Cloudflare can see of a visitor's
// connection (their city and network, and whether they're in the EU), for
// personalizing the paper (src/signals). Nothing is stored; it's the
// visitor's own information, handed back to their browser.
//
// Everything else goes to the desk (Khalil's Arch desktop) through the
// tunnel. If the desk doesn't answer within 3 seconds (it's asleep, or
// restarting after a deploy), the Worker serves the copy of the site that
// was deployed with it, so the site never goes down. The x-served-from header
// says which one answered, and /api/desk says { live: false } for the copy.

export interface Env {
  /** The copy of dist/ deployed with the Worker. */
  ASSETS: { fetch(request: Request): Promise<Response> }
  /** The desk, through the tunnel: https://desk.<domain> (unset: always the copy). */
  ORIGIN?: string
}

/** The parts of Cloudflare's request.cf the site uses. */
export interface Cf {
  city?: string
  region?: string
  country?: string
  asOrganization?: string
  isEUCountry?: string
}

/** How long to wait for the desk before serving the copy. */
export const DESK_TIMEOUT = 3000

const SECURITY: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
}

/** Request headers worth passing on to the desk (none of them about the visitor). */
const FORWARD = ['accept', 'accept-encoding', 'if-none-match', 'if-modified-since', 'range']

export default {
  async fetch(request: Request & { cf?: Cf }, env: Env): Promise<Response> {
    const url = new URL(request.url)
    // One address for the site: www.<domain> is sent to <domain>.
    if (url.hostname.startsWith('www.')) {
      url.hostname = url.hostname.slice('www.'.length)
      return mark(new Response(null, { status: 308, headers: { location: url.href } }), 'edge')
    }
    if (url.pathname === '/api/visitor') return visitor(request.cf)

    if (env.ORIGIN) {
      try {
        const headers = new Headers()
        for (const name of FORWARD) {
          const value = request.headers.get(name)
          if (value) headers.set(name, value)
        }
        const answer = await fetch(new URL(url.pathname + url.search, env.ORIGIN), {
          method: request.method,
          headers,
          redirect: 'manual',
          signal: AbortSignal.timeout(DESK_TIMEOUT),
        })
        if (answer.status < 500) return mark(answer, 'desk')
      } catch {
        // Asleep, or too slow: the copy it is.
      }
    }
    if (url.pathname === '/api/desk') return json({ live: false })
    return mark(await env.ASSETS.fetch(request), 'copy')
  },
}

function visitor(cf: Cf = {}) {
  return json(
    { city: cf.city, region: cf.region, country: cf.country, org: cf.asOrganization, eu: cf.isEUCountry === '1' },
    { 'cache-control': 'private, no-store' },
  )
}

function json(body: unknown, headers: Record<string, string> = {}) {
  return mark(new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } }), 'edge')
}

/** The same response, saying where it came from (with the security headers, whoever sent it). */
function mark(response: Response, from: 'desk' | 'copy' | 'edge') {
  const marked = new Response(response.body, response)
  for (const [name, value] of Object.entries(SECURITY)) marked.headers.set(name, value)
  marked.headers.set('x-served-from', from)
  return marked
}
