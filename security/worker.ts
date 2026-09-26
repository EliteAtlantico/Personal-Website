// Attacks on the Worker (edge/worker.ts), the only code of the site's that
// runs on Cloudflare: it answers /api/visitor and nothing else. It runs here
// with fetch replaced, so anything it asked of the outside world would be
// written down (it should never ask anything).
import worker, { type Cf } from '../edge/worker'
import { Checks, type Finding } from './checks'

const SITE = 'https://chaghouri.example'

export async function attackWorker(): Promise<Finding[]> {
  const checks = new Checks('Worker')
  const asked: string[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    asked.push(new Request(input).url)
    return new Response('elsewhere')
  }) as typeof fetch
  const call = (path: string, init: RequestInit & { cf?: Cf } = {}) => worker.fetch(Object.assign(new Request(SITE + path, init), { cf: init.cf }))

  try {
    // --- It fetches nothing, whatever the address (SSRF) ---
    const tricks = ['/api/visitor', '/api/.//evil.example/', '/api/%2e//evil.example/x', '/.//169.254.169.254/latest/meta-data/', '//localhost:8787/', '/api/visitor?url=https://evil.example/']
    const responses: Response[] = []
    for (const path of tricks) responses.push(await call(path, { headers: { cookie: 'session=secret', 'x-forwarded-host': 'evil.example' } }))
    checks.expect('it never fetches anything, whatever the address', !asked.length, 'critical', asked.join(', '))

    // --- /api/visitor is for the visitor's own browser only ---
    const visitor = await call('/api/visitor', { headers: { origin: 'https://evil.example' }, cf: { city: 'Toronto', asOrganization: 'Example Networks', isEUCountry: '0' } })
    const fields = Object.keys((await visitor.clone().json()) as object)
    checks.expect('/api/visitor cannot be read by other sites (no CORS)', !visitor.headers.get('access-control-allow-origin'), 'medium')
    checks.expect('/api/visitor is never cached', /private/.test(visitor.headers.get('cache-control') ?? '') && /no-store/.test(visitor.headers.get('cache-control') ?? ''), 'medium', visitor.headers.get('cache-control') ?? 'missing')
    checks.expect("/api/visitor hands back only the visitor's city, region, country and network", fields.every((f) => ['city', 'region', 'country', 'org', 'eu'].includes(f)), 'low', `fields: ${fields.join(', ')}`)
    const echoed = await call('/api/visitor', { cf: { city: '<img src=x onerror=alert(1)>' } })
    checks.expect("what it hands back is JSON, never HTML (Cloudflare's names can't become a page)", /^application\/json/.test(echoed.headers.get('content-type') ?? ''), 'medium', echoed.headers.get('content-type') ?? 'missing')

    // --- Nothing else ---
    const unknown = await call('/api/desk')
    const posted = await call('/api/visitor', { method: 'POST', body: 'x' })
    checks.expect('any other address sent its way is a 404', unknown.status === 404, 'low', `status ${unknown.status}`)
    checks.expect('only GET and HEAD are answered', posted.status === 405, 'low', `status ${posted.status}`)

    // --- Security headers on everything it sends ---
    const samples: Array<[string, Response]> = [
      ['/api/visitor', visitor],
      ['a 404', unknown],
      ['a refused method', posted],
      ...responses.slice(1, 3).map((r, i) => [`an odd address (${tricks[i + 1]})`, r] as [string, Response]),
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
