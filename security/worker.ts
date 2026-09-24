// Attacks on the Worker in front of the desk (edge/worker.ts). It runs here
// with fetch replaced, so everything it asks of the outside world is written
// down: where it went, and what it passed on.
import worker, { type Env } from '../edge/worker'
import { Checks, type Finding } from './checks'

const SITE = 'https://chaghouri.example'
const ORIGIN = 'https://desk.chaghouri.example'

export async function attackWorker(): Promise<Finding[]> {
  const checks = new Checks('Worker')
  const asked: Array<{ url: string; headers: Record<string, string> }> = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    asked.push({ url: request.url, headers: Object.fromEntries(request.headers) })
    return new Response('<h1>the desk</h1>', { headers: { 'content-type': 'text/html; charset=utf-8' } })
  }) as typeof fetch
  const copy: Env['ASSETS'] = {
    fetch: async (request) => (new URL(request.url).pathname.startsWith('/assets/known') ? new Response('copy') : new Response('missing', { status: 404 })),
  }
  const env: Env = { ASSETS: copy, ORIGIN }
  const call = (url: string, init?: RequestInit) => worker.fetch(new Request(url, init), env)

  try {
    // --- The Worker must only ever fetch from the desk ---
    const tricks = ['/.//evil.example/', '/%2e//evil.example/x', '/a/..//evil.example/', '/.///evil.example/', '/.//evil.example:8080/', '/.//169.254.169.254/latest/meta-data/', '/.//localhost:8787/api/desk']
    for (const path of tricks) {
      asked.length = 0
      const response = await call(SITE + path)
      const elsewhere = asked.filter((a) => new URL(a.url).origin !== ORIGIN)
      checks.expect(`GET ${path} is only ever sent to the desk`, !elsewhere.length, 'critical', elsewhere.length ? `the Worker fetched ${elsewhere.map((a) => a.url).join(', ')} and served it as the site (status ${response.status})` : undefined)
    }

    // --- Nothing about the visitor is passed on ---
    asked.length = 0
    await call(`${SITE}/`, {
      headers: { cookie: 'session=secret', authorization: 'Bearer secret', 'x-forwarded-for': '203.0.113.9', 'cf-connecting-ip': '203.0.113.9', 'true-client-ip': '203.0.113.9', 'user-agent': 'Visitor/1.0', referer: 'https://elsewhere.example/private' },
    })
    const forwarded = Object.keys(asked[0]?.headers ?? {})
    const leaked = forwarded.filter((h) => ['cookie', 'authorization', 'x-forwarded-for', 'cf-connecting-ip', 'true-client-ip', 'user-agent', 'referer'].includes(h))
    checks.expect("the visitor's cookies, credentials, address and browser aren't passed to the desk", !leaked.length, 'medium', leaked.length ? `forwarded: ${leaked.join(', ')}` : undefined)

    // --- Redirects stay on the site ---
    for (const url of ['https://www.chaghouri.example/.//evil.example/', 'https://www.chaghouri.example//evil.example/']) {
      const response = await call(url)
      const location = response.headers.get('location') ?? ''
      const host = location ? new URL(location, url).host : ''
      checks.expect(`the www redirect for ${url} stays on the site`, !location || host === 'chaghouri.example', 'medium', `Location: ${location}`)
    }
    const plain = await call('http://www.chaghouri.example/research/x?y=1')
    checks.expect('http:// is sent to https:// (and www to the bare domain) in one redirect', plain.status === 308 && plain.headers.get('location') === 'https://chaghouri.example/research/x?y=1', 'low', `${plain.status} to ${plain.headers.get('location')}`)

    // --- /api/visitor is for the visitor's own browser only ---
    const visitor = await worker.fetch(Object.assign(new Request(`${SITE}/api/visitor`, { headers: { origin: 'https://evil.example' } }), { cf: { city: 'Toronto' } }), env)
    checks.expect('/api/visitor cannot be read by other sites (no CORS)', !visitor.headers.get('access-control-allow-origin'), 'medium')
    checks.expect('/api/visitor is never cached', /no-store/.test(visitor.headers.get('cache-control') ?? ''), 'medium')

    // --- Security headers on everything the Worker sends ---
    const samples: Array<[string, Response]> = [
      ['a page from the desk', await call(`${SITE}/`)],
      ['an asset from the copy', await call(`${SITE}/assets/known.js`)],
      ['/api/visitor', visitor],
      ['the www redirect', await call('https://www.chaghouri.example/')],
      ['the https:// redirect', plain],
      ['a page from the copy (desk down)', await worker.fetch(new Request(`${SITE}/`), { ASSETS: copy })],
    ]
    for (const [what, response] of samples) {
      const h = (name: string) => response.headers.get(name) ?? ''
      checks.expect(`${what} sends nosniff and DENY`, h('x-content-type-options') === 'nosniff' && h('x-frame-options') === 'DENY', 'low')
      checks.expect(`${what} forbids framing (CSP frame-ancestors)`, /frame-ancestors 'none'/.test(h('content-security-policy')), 'low', h('content-security-policy') || 'missing')
      checks.expect(`${what} tells browsers to always use HTTPS (HSTS)`, /max-age=\d{7,}/.test(h('strict-transport-security')), 'low', h('strict-transport-security') || 'missing')
      checks.expect(`${what} keeps other windows out (COOP)`, h('cross-origin-opener-policy') === 'same-origin', 'low', h('cross-origin-opener-policy') || 'missing')
    }
  } finally {
    globalThis.fetch = realFetch
  }
  return checks.findings
}
