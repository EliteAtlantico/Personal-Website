// Attacks on the site as it's deployed: Cloudflare's edge, the Worker, the
// copy of the site it serves, and the desk behind it once the tunnel is up.
// The other suites test what's built here; this one tests what visitors get,
// which also depends on how Cloudflare is set up (TLS, redirects, what was
// uploaded, anything Cloudflare adds to the pages). Requests are written
// straight to the socket, one at a time, so a path reaches the Worker exactly
// as an attacker typed it. It reads only; then it runs the browser attacks
// on the real pages.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import net from 'node:net'
import tls from 'node:tls'
import { attackBrowser } from './browser'
import { Checks, type Finding } from './checks'
import { PHONES, SECRETS } from './repo'

/** The site until it has a domain (SITE_URL, or an address given on the command line, tests another). */
export const LIVE = 'https://personal-website.khalil-chaghouri.workers.dev'

interface Reply {
  status: number
  headers: Record<string, string>
  body: Buffer
  text: string
}

/** Writes `request` as it is over HTTPS (or plain HTTP), and reads until the server closes the connection. */
function send(site: URL, request: string, secure = true): Promise<Reply> {
  return new Promise((resolve) => {
    const socket = secure
      ? tls.connect({ host: site.hostname, port: 443, servername: site.hostname, ALPNProtocols: ['http/1.1'], rejectUnauthorized: true })
      : net.connect(80, site.hostname)
    const chunks: Buffer[] = []
    let finished = false
    const done = () => {
      if (finished) return
      finished = true
      socket.destroy()
      resolve(parse(Buffer.concat(chunks)))
    }
    socket.setTimeout(20_000, done)
    socket.on('data', (d: Buffer) => chunks.push(d))
    socket.on('end', done)
    socket.on('close', done)
    socket.on('error', done)
    socket.once(secure ? 'secureConnect' : 'connect', () => socket.write(request))
  })
}

function parse(raw: Buffer): Reply {
  const end = raw.indexOf('\r\n\r\n')
  const head = raw.toString('latin1', 0, end < 0 ? raw.length : end)
  const headers: Record<string, string> = {}
  for (const line of head.split('\r\n').slice(1)) {
    const i = line.indexOf(':')
    if (i < 1) continue
    const name = line.slice(0, i).trim().toLowerCase()
    const value = line.slice(i + 1).trim()
    headers[name] = headers[name] ? `${headers[name]}, ${value}` : value
  }
  let body = end < 0 ? Buffer.alloc(0) : raw.subarray(end + 4)
  if (/chunked/i.test(headers['transfer-encoding'] ?? '')) body = dechunk(body)
  return { status: Number(/^HTTP\/1\.[01] (\d{3})/.exec(head)?.[1] ?? 0), headers, body, text: body.toString('utf8') }
}

function dechunk(body: Buffer) {
  const parts: Buffer[] = []
  for (let at = 0; at < body.length; ) {
    const eol = body.indexOf('\r\n', at)
    const size = eol < 0 ? 0 : parseInt(body.toString('latin1', at, eol), 16)
    if (!size) break
    parts.push(body.subarray(eol + 2, eol + 2 + size))
    at = eol + 2 + size + 2
  }
  return Buffer.concat(parts)
}

const request = (site: URL, target: string, method = 'GET', headers: Record<string, string> = {}) =>
  [`${method} ${target} HTTP/1.1`, `Host: ${site.host}`, 'User-Agent: chaghouri-security-suite', 'Accept-Encoding: identity', ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`), 'Connection: close', '', ''].join('\r\n')

/** Which TLS versions the site accepts. Asked through Node: its OpenSSL can still be made to offer TLS 1.0 and 1.1, and Bun's can't. */
function tlsVersions(host: string): Record<string, boolean> {
  const script = `const tls = require('node:tls')
const offer = (v) => new Promise((resolve) => {
  const s = tls.connect({ host: ${JSON.stringify(host)}, port: 443, servername: ${JSON.stringify(host)}, minVersion: v, maxVersion: v, ciphers: 'DEFAULT@SECLEVEL=0' }, () => { resolve(true); s.destroy() })
  s.on('error', () => resolve(false))
  s.setTimeout(10000, () => { resolve(false); s.destroy() })
})
;(async () => { const out = {}; for (const v of ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3']) out[v] = await offer(v); console.log(JSON.stringify(out)) })()`
  return JSON.parse(execFileSync(process.env.NODE ?? 'node', ['-e', script], { encoding: 'utf8' }))
}

/** Headers every response must carry, whoever sends it (the Worker, the copy, the desk). */
const REQUIRED: Record<string, (value: string) => boolean> = {
  'strict-transport-security': (v) => Number(/max-age=(\d+)/.exec(v)?.[1] ?? 0) >= 31_536_000,
  'content-security-policy': (v) => /frame-ancestors 'none'/.test(v),
  'x-frame-options': (v) => v === 'DENY',
  'x-content-type-options': (v) => v === 'nosniff',
  'referrer-policy': (v) => !!v,
  'cross-origin-opener-policy': (v) => v === 'same-origin',
  'cross-origin-resource-policy': (v) => v === 'same-origin',
  'permissions-policy': (v) => /camera=\(\)/.test(v),
}

/** Files that must never be published: private ones, then the project's own (public on GitHub, but not the site's). */
const PRIVATE_PATHS = ['/.env', '/.dev.vars', '/.git/config', '/.git/HEAD', '/.wrangler/', '/.cloudflared/', '/KC_Resume.pdf', '/resume/private.tex', '/content/private/', '/deploy/README.md']
const PROJECT_PATHS = ['/.assetsignore', '/.DS_Store', '/package.json', '/bun.lock', '/wrangler.jsonc', '/tsconfig.json', '/vite.config.ts', '/edge/worker.ts', '/server/site.ts', '/src/main.ts', '/build/server.mjs', '/deploy/deploy.sh', '/security/run.ts', '/index.html.br', '/index.html.gz', '/_headers', '/_redirects', '/_worker.js']

/** A link to one of the site's pages ("/now", "/research/brain-freeze"). */
const LINK = /href="(\/[a-z0-9-]+(?:\/[a-z0-9-]+)?)"/g

/** Addresses on the desk's own network (the LAN, Tailscale) and local host names. */
const INTERNAL = /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3})\b|\b[\w-]+\.(?:local|lan|ts\.net)\b/

export async function attackLive(address = LIVE, { browser = true } = {}): Promise<Finding[]> {
  const site = new URL(address)
  const checks = new Checks(`Live site (${site.host})`)
  const get = (target: string, headers: Record<string, string> = {}) => send(site, request(site, target, 'GET', headers))
  const offsite = (location: string | undefined) => {
    if (!location) return false
    try {
      return new URL(location, site).host !== site.host
    } catch {
      return false
    }
  }

  const home = await get('/')
  if (home.status !== 200) {
    checks.expect('the site answers over HTTPS with a certificate browsers trust', false, 'high', `status ${home.status}`)
    return checks.findings
  }
  const desk = JSON.parse((await get('/api/desk')).text || '{}') as { live?: boolean }
  console.log(`Testing ${site.origin}${desk.live === false ? " (the desk isn't connected, so every page comes from the copy)" : ''}`)

  // --- Transport ---
  const plain = await send(site, request(site, '/research?x=1'), false)
  const upgraded = [301, 302, 307, 308].includes(plain.status) && (plain.headers.location ?? '').startsWith(`https://${site.host}/`)
  // Browsers never use http:// on these at all: the whole top-level domain is on their HSTS preload list.
  const preloaded = /\.(?:dev|app|page)$/.test(site.hostname)
  checks.expect('plain http:// is sent to https://', upgraded, preloaded ? 'info' : 'low', `http:// answered ${plain.status}${preloaded ? `, though browsers never use http:// for .${site.hostname.split('.').pop()} addresses (HSTS preload)` : ''}`)
  try {
    const versions = tlsVersions(site.hostname)
    const old = ['TLSv1', 'TLSv1.1'].filter((v) => versions[v])
    const workersDev = site.hostname.endsWith('.workers.dev')
    checks.expect('old TLS (1.0 and 1.1) is refused', !old.length, workersDev ? 'info' : 'low', `${old.join(' and ')} accepted: ${workersDev ? "Cloudflare's choice on workers.dev; on your own domain, " : ''}set Minimum TLS Version to 1.2 (SSL/TLS, Edge Certificates)`)
    checks.expect('TLS 1.3 is offered', !!versions['TLSv1.3'], 'low')
  } catch (error) {
    checks.expect('TLS versions could be tested (it needs node)', false, 'info', (error as Error).message.split('\n')[0])
  }

  // --- Every kind of response carries the security headers ---
  const links = [...new Set([...home.text.matchAll(LINK)].map(([, href]) => href!))]
  const storyPath = links.find((href) => href.split('/').length === 3) ?? '/now'
  const [terminal, story] = [await get('/terminal'), await get(storyPath)]
  const asset = (pattern: RegExp) => pattern.exec(home.text)?.[1]
  const script = asset(/src="(\/assets\/[^"]+\.js)"/)
  const style = asset(/href="(\/assets\/[^"]+\.css)"/)
  const font = asset(/href="(\/assets\/[^"]+\.woff2)"/)
  const image = asset(/["\s,](\/media\/[^"\s,]+\.(?:webp|jpe?g|png|avif))/)
  const resume = await get('/resume.pdf')
  const samples: Array<[string, Reply]> = [
    ['the front page', home],
    ['the terminal', terminal],
    [`a story (${storyPath})`, story],
    ['the 404 page', await get('/no-such-page')],
    ['a redirect', await get('/terminal/')],
    ['the résumé', resume],
    ['/api/desk', await get('/api/desk')],
    ['/api/visitor', await get('/api/visitor')],
    ['a refused method', await send(site, request(site, '/', 'POST', { 'Content-Length': '0' }))],
  ]
  for (const [what, target] of [['a script', script], ['a stylesheet', style], ['a font', font], ['a photo', image]] as const) if (target) samples.push([what, await get(target)])
  if (resume.headers.etag) samples.push(['an unchanged file (304)', await get('/resume.pdf', { 'If-None-Match': resume.headers.etag })])
  for (const [what, reply] of samples) {
    const wrong = Object.entries(REQUIRED).filter(([name, valid]) => !valid(reply.headers[name] ?? '')).map(([name]) => name)
    const framing = wrong.includes('content-security-policy') && wrong.includes('x-frame-options')
    checks.expect(`${what} carries every security header`, !wrong.length, framing ? 'medium' : 'low', `status ${reply.status}; missing or wrong: ${wrong.join(', ')}`)
    const software = [reply.headers['x-powered-by'], reply.headers.server].filter((v) => v && !/^cloudflare$/i.test(v))
    checks.expect(`${what} doesn't say what software serves it`, !software.length, 'low', software.join(', '))
  }
  const utf8 = (r: Reply) => /^text\/html/.test(r.headers['content-type'] ?? '') && (/charset=utf-8/i.test(r.headers['content-type'] ?? '') || /<meta charset="utf-8"/i.test(r.text.slice(0, 1024)))
  checks.expect('pages are HTML in UTF-8 (by header, or a <meta> at the very top)', [home, terminal, story].every(utf8), 'low')

  // --- The pages' own content security policy (the build writes it, with each inline script's hash) ---
  for (const [what, page] of [['the front page', home], ['the terminal', terminal], [`a story (${storyPath})`, story]] as const) {
    const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/i.exec(page.text)?.[1] ?? ''
    const allowed = /script-src([^;]*)/.exec(policy)?.[1] ?? ''
    // Inline scripts that run (not ones with a src, nor data blocks such as JSON).
    const inline = [...page.text.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)]
      .filter(([, attributes = '']) => !/\ssrc=/.test(attributes) && (!/\stype=/.test(attributes) || /type="(?:module|text\/javascript)"/.test(attributes)))
      .map(([, , code = '']) => code)
    const unhashed = inline.filter((code) => !allowed.includes(`'sha256-${createHash('sha256').update(code).digest('base64')}'`))
    const foreign = [...page.text.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(([, src]) => src!).filter((src) => new URL(src, site).origin !== site.origin)
    const ok = /'self'/.test(allowed) && !/unsafe-inline|unsafe-eval|\*|https?:/.test(allowed) && !unhashed.length && !foreign.length
    const detail = !policy ? 'no policy' : [unhashed.length && `${unhashed.length} inline script(s) it doesn't allow (added by Cloudflare?)`, foreign.length && `scripts from ${foreign.join(', ')}`, `script-src${allowed}`].filter(Boolean).join('; ')
    checks.expect(`${what} lets only its own scripts run (content security policy)`, ok, 'medium', detail)
  }

  // --- What's published ---
  for (const [paths, severity] of [[PRIVATE_PATHS, 'high'], [PROJECT_PATHS, 'low']] as const) {
    for (const target of paths) {
      const reply = await get(target)
      checks.expect(`${target} is not published`, [400, 403, 404].includes(reply.status), severity, `status ${reply.status}`)
    }
  }
  // Every script and stylesheet: the pages', and the chunks the main script loads later (the
  // terminal, the globe). A Set visits what's added to it while it's being walked.
  const files = new Set<string>()
  for (const page of [home, terminal, story]) for (const [, src] of page.text.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)) files.add(src!)
  const texts: string[] = []
  const mapped: string[] = []
  for (const target of files) {
    const reply = await get(target)
    texts.push(reply.text)
    if (/\/[/*][#@] sourceMappingURL=/.test(reply.text)) mapped.push(`${target} points to a map`)
    if ((await get(`${target}.map`)).status !== 404) mapped.push(`${target}.map`)
    for (const [, chunk] of reply.text.matchAll(/["'`]\.\/([\w.-]+\.(?:js|css))["'`]/g)) files.add(`/assets/${chunk}`)
  }
  checks.expect('no source maps are published (the original code, with comments)', !mapped.length, 'low', mapped.join(', '))
  // Every page, following links from each one.
  const pages = new Map([['/', home], ['/terminal', terminal], [storyPath, story]])
  const queue = new Set(['/', ...links])
  for (const target of queue) {
    const page = pages.get(target) ?? (await get(target))
    pages.set(target, page)
    texts.push(page.text)
    for (const [, href] of page.text.matchAll(LINK)) if (queue.size < 500) queue.add(href!)
  }
  const scripts = [...files].filter((f) => f.endsWith('.js'))
  const published = texts.join('\n')
  const secrets = SECRETS.filter(([, pattern]) => pattern.test(published)).map(([what]) => what)
  checks.expect(`no secrets in anything published (${pages.size} pages, ${scripts.length} scripts)`, !secrets.length, 'critical', secrets.join(', '))
  const numbers = [...new Set(PHONES.flatMap((pattern) => [...published.matchAll(pattern)].map((m) => m[0])))]
  checks.expect('no phone numbers in anything published', !numbers.length, 'high', numbers.slice(0, 5).join(', '))
  const emails = [...new Set(published.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? [])].filter((e) => !/\.(png|jpe?g|webp|svg|js|css)$/.test(e))
  checks.expect('the only email address published is the one meant to be public', emails.every((e) => e === 'khalil.chaghouri@mail.utoronto.ca'), 'low', emails.join(', '))
  try {
    const text = execFileSync('pdftotext', ['-layout', '-', '-'], { input: resume.body, encoding: 'utf8' })
    const found = PHONES.flatMap((pattern) => [...text.matchAll(pattern)].map((m) => m[0]))
    checks.expect('the published résumé has no phone number', !!text.trim() && !found.length, 'high', found.join(', ') || 'no text in it')
  } catch {
    checks.expect('the published résumé could be read (pdftotext)', false, 'info')
  }

  // --- The Worker fetches only from the desk (SSRF): paths that read as an address of their own ---
  for (const target of ['/.//example.com/', '/%2e//example.com/', '/a/..//example.com/', '/.///example.com/', '//example.com/', '/\\example.com/']) {
    const reply = await get(target)
    checks.expect(`GET ${target} doesn't serve another site`, !/Example Domain/.test(reply.text), 'critical', `status ${reply.status}`)
  }

  // --- Redirects stay on the site ---
  for (const target of ['/.//evil.example/', '//evil.example/', '///evil.example/', '/%2e//evil.example/', '/\\/evil.example/', '/%5c%5cevil.example/', '/%2f%2fevil.example/', '/.%2f%2fevil.example/', '/.//evil.example/index.html', '/.//evil.example.html', '//evil.example/terminal/', '/terminal/..//evil.example/']) {
    const reply = await get(target)
    checks.expect(`no redirect off the site for GET ${target}`, !offsite(reply.headers.location), 'medium', `${reply.status} to ${reply.headers.location}`)
  }

  // --- Methods ---
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'TRACE']) {
    const reply = await send(site, request(site, '/', method, { 'Content-Length': '0', 'X-Canary': 'echo-me' }))
    checks.expect(`${method} is refused`, reply.status >= 400 && reply.status < 500, 'low', `status ${reply.status}`)
    if (method === 'TRACE') checks.expect('TRACE does not echo the request back', !reply.text.includes('echo-me'), 'medium')
  }

  // --- The APIs ---
  const visitor = await get('/api/visitor', { Origin: 'https://evil.example' })
  const fields = Object.keys(JSON.parse(visitor.text || '{}'))
  checks.expect('/api/visitor cannot be read by other sites (no CORS)', !visitor.headers['access-control-allow-origin'], 'medium', visitor.headers['access-control-allow-origin'])
  checks.expect('/api/visitor is never cached, even by the browser', /private/.test(visitor.headers['cache-control'] ?? '') && /no-store/.test(visitor.headers['cache-control'] ?? ''), 'medium', visitor.headers['cache-control'])
  checks.expect("/api/visitor hands back only the visitor's city, region, country and network", fields.every((f) => ['city', 'region', 'country', 'org', 'eu'].includes(f)), 'low', `fields: ${fields.join(', ')}`)
  const deskReply = await get('/api/desk', { Origin: 'https://evil.example' })
  const deskInfo = JSON.parse(deskReply.text || '{}') as { kernel?: string }
  checks.expect('/api/desk cannot be read by other sites (no CORS)', !deskReply.headers['access-control-allow-origin'], 'low', deskReply.headers['access-control-allow-origin'])
  checks.expect('/api/desk is never cached', /no-store/.test(deskReply.headers['cache-control'] ?? ''), 'low', deskReply.headers['cache-control'])
  checks.expect("/api/desk doesn't give the exact kernel build", !/^\d+\.\d+\.\d+/.test(deskInfo.kernel ?? ''), 'low', `kernel: ${deskInfo.kernel}`)
  const internal = [deskReply, home, terminal, story].map((r) => INTERNAL.exec(`${JSON.stringify(r.headers)}\n${r.text}`)?.[0]).filter(Boolean)
  checks.expect("nothing gives away addresses on the desk's own network", !internal.length, 'medium', internal.join(', '))

  // --- Cache poisoning: headers a cache ignores mustn't change what the next visitor gets ---
  const fingerprint = (r: Reply) => createHash('sha256').update(r.body).digest('hex')
  const poisoned = await get('/', {
    'X-Forwarded-Host': 'evil.example',
    'X-Host': 'evil.example',
    'X-Forwarded-Server': 'evil.example',
    Forwarded: 'host=evil.example;proto=http',
    'X-Forwarded-Proto': 'http',
    'X-Forwarded-Scheme': 'http',
    'X-Original-URL': '/terminal',
    'X-Rewrite-URL': '/terminal',
    'X-HTTP-Method-Override': 'DELETE',
  })
  checks.expect("forwarding headers don't change the page (cache poisoning)", fingerprint(poisoned) === fingerprint(home) && !poisoned.headers.location, 'medium', `status ${poisoned.status}${poisoned.headers.location ? ` to ${poisoned.headers.location}` : ''}`)
  checks.expect('the next visitor gets the page unchanged', fingerprint(await get('/')) === fingerprint(home), 'high')

  // --- Nothing from the address comes back in a page (reflected XSS) ---
  const canary = `kc${Math.random().toString(36).slice(2, 10)}`
  const reflected: string[] = []
  for (const target of [`/${canary}`, `/?${canary}=${canary}`, `/research/${canary}`, `/terminal?cmd=${canary}#${canary}`]) {
    const reply = await get(target)
    if (reply.text.includes(canary) || Object.values(reply.headers).some((v) => v.includes(canary))) reflected.push(target)
  }
  checks.expect('nothing from the address is written into a page (reflected XSS)', !reflected.length, 'high', reflected.join(', '))

  // --- Odd addresses: never a crash, a stack trace, or a file from outside the site ---
  const odd = ['/%', '/%E0%A4%A', '/api/%ff', '/assets/%', '/research/%00', '/assets/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/%2e%2e/etc/passwd', '/..%5c..%5cpackage.json', `/${'a'.repeat(8000)}`, `/?${'a=1&'.repeat(1500)}`]
  const broke: string[] = []
  for (const target of odd) {
    const reply = await get(target)
    if (reply.status >= 500 || /Worker threw exception|Error 1101|\bat .+\(.+:\d+:\d+\)|root:x:0:0|"name": "chaghouri-times"/.test(reply.text)) broke.push(`${target.slice(0, 40)} (${reply.status})`)
  }
  checks.expect('odd addresses never crash the Worker or reach a file outside the site', !broke.length, 'medium', broke.join(', '))

  // --- The real pages, in a browser ---
  return browser ? [...checks.findings, ...(await attackBrowser(site.origin))] : checks.findings
}
