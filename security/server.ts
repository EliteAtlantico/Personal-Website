// Attacks on the desk's server as it runs in production: build/server.mjs,
// under Node, serving dist/. Requests are written straight to a socket, so
// they can be as malformed as an attacker likes.
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { Checks, type Finding } from './checks'

interface Reply {
  status: number
  headers: Record<string, string>
  body: string
  /** Everything that came back (to spot a second, smuggled response). */
  raw: string
}

/** Writes `request` to the server as it is, and reads until it closes the connection (or goes quiet). */
function send(port: number, request: string, wait = 2500): Promise<Reply> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1')
    const chunks: Buffer[] = []
    let finished = false
    const done = () => {
      if (finished) return
      finished = true
      socket.destroy()
      const raw = Buffer.concat(chunks).toString('latin1')
      const [head = '', ...rest] = raw.split('\r\n\r\n')
      const headers: Record<string, string> = {}
      for (const line of head.split('\r\n').slice(1)) {
        const i = line.indexOf(':')
        if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
      }
      resolve({ status: Number(/^HTTP\/1\.[01] (\d{3})/.exec(head)?.[1] ?? 0), headers, body: rest.join('\r\n\r\n'), raw })
    }
    socket.setTimeout(wait, done)
    socket.on('data', (d: Buffer) => chunks.push(d))
    socket.on('end', done)
    socket.on('close', done)
    socket.on('error', done)
    socket.write(request)
  })
}

const get = (port: number, target: string, extra = '') => send(port, `GET ${target} HTTP/1.1\r\nHost: desk\r\nConnection: close\r\n${extra}\r\n`)

async function start(): Promise<{ port: number; stop(): void }> {
  const server = path.resolve('build/server.mjs')
  if (!existsSync(server) || !existsSync('dist/index.html')) throw new Error('Build first: bun run build && bun run build:server')
  const port = 20000 + Math.floor(Math.random() * 20000)
  const child = spawn(process.env.NODE ?? 'node', [server], {
    env: { ...process.env, SITE_DIST: path.resolve('dist'), HOST: '127.0.0.1', PORT: String(port), DESK_NAME: 'the test desk' },
    stdio: 'ignore',
  })
  for (let i = 0; i < 100; i++) {
    const up = await new Promise<boolean>((resolve) => {
      const socket = net.connect(port, '127.0.0.1', () => {
        socket.destroy()
        resolve(true)
      })
      socket.on('error', () => resolve(false))
    })
    if (up) return { port, stop: () => child.kill() }
    await new Promise((r) => setTimeout(r, 100))
  }
  child.kill()
  throw new Error('The server did not start')
}

/** Text that must never come back: files from outside dist/ (the project, the server's code, the system). */
const SECRETS = ['"name": "chaghouri-times"', 'export function site(', 'root:x:0:0', 'PRIVATE KEY']
const leaks = (body: string) => SECRETS.find((s) => body.includes(s))

/** Headers every response must carry. */
const REQUIRED: Record<string, (value: string | undefined) => boolean> = {
  'x-content-type-options': (v) => v === 'nosniff',
  'x-frame-options': (v) => v === 'DENY',
  'referrer-policy': (v) => !!v,
  'content-security-policy': (v) => !!v && /frame-ancestors 'none'/.test(v),
}

export async function attackServer(): Promise<Finding[]> {
  const checks = new Checks('Desk server')
  const { port, stop } = await start()
  try {
    // --- Reading files outside dist/ ---
    const traversals = [
      '/../package.json',
      '/..%2fpackage.json',
      '/%2e%2e/package.json',
      '/%2e%2e%2fpackage.json',
      '/.%2e/package.json',
      '/assets/../../package.json',
      '/assets/..%2f..%2fpackage.json',
      '/assets/%2e%2e%2f%2e%2e%2fpackage.json',
      '/..%5cpackage.json',
      '/..\\package.json',
      '/%252e%252e/package.json',
      '/%c0%ae%c0%ae/package.json',
      '/%00/../package.json',
      '/....//package.json',
      '/../../../../../../etc/passwd',
      '/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd',
      '/assets/%2e%2e/%2e%2e/server/site.ts',
      '/../server/site.ts',
      '//etc/passwd',
    ]
    for (const target of traversals) {
      const reply = await get(port, target)
      const leak = leaks(reply.body)
      checks.expect(`no file outside dist/ for GET ${target}`, !leak, 'critical', leak ? `status ${reply.status}, body contains ${leak}` : undefined)
    }

    // --- Files in dist/ that aren't the site ---
    const dotfiles = readdirSync('dist').filter((f) => f.startsWith('.'))
    for (const file of dotfiles) {
      const reply = await get(port, `/${file}`)
      checks.expect(`hidden file /${file} is not served`, reply.status === 404, 'low', `status ${reply.status}`)
    }
    const maps = existsSync('dist/assets') ? readdirSync('dist/assets').filter((f) => f.endsWith('.map')) : []
    if (maps[0]) {
      const reply = await get(port, `/assets/${maps[0]}`)
      checks.expect('source maps are not served', reply.status === 404, 'low', `/assets/${maps[0]}: status ${reply.status}`)
    }

    // --- Redirects that leave the site ---
    const redirects = ['/.//evil.example/', '/%2e//evil.example/', '/.//evil.example.html', '/a/..//evil.example/index.html', '/\\/evil.example/', '/%5c%5cevil.example/', '/.%2f%2fevil.example/', '/.///evil.example/x/']
    for (const target of redirects) {
      const reply = await get(port, target)
      const location = reply.headers.location
      const offsite = reply.status >= 300 && reply.status < 400 && !!location && !/^\/(?![/\\])/.test(location)
      checks.expect(`no redirect off the site for GET ${target}`, !offsite, 'medium', offsite ? `${reply.status} to ${location}` : undefined)
    }

    // --- Methods ---
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'TRACE']) {
      const reply = await send(port, `${method} / HTTP/1.1\r\nHost: desk\r\nX-Canary: echo-me\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`)
      checks.expect(`${method} is refused`, reply.status === 405 || reply.status === 400, 'medium', `status ${reply.status}`)
      if (method === 'TRACE') checks.expect('TRACE does not echo the request', !reply.body.includes('echo-me'), 'medium')
    }

    // --- Malformed and smuggled requests (Node's parser must refuse them) ---
    const malformed: Array<[string, string]> = [
      ['Content-Length with Transfer-Encoding', 'POST / HTTP/1.1\r\nHost: desk\r\nContent-Length: 4\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\nGET /smuggled HTTP/1.1\r\nHost: desk\r\n\r\n'],
      ['two different Content-Lengths', 'POST / HTTP/1.1\r\nHost: desk\r\nContent-Length: 0\r\nContent-Length: 44\r\n\r\nGET /smuggled HTTP/1.1\r\nHost: desk\r\n\r\n'],
      ['a line break in the request line', 'GET /a\r\nX-Injected: 1 HTTP/1.1\r\nHost: desk\r\nConnection: close\r\n\r\n'],
      ['a folded header (obsolete)', 'GET / HTTP/1.1\r\nHost: desk\r\nX-Folded: a\r\n b\r\nConnection: close\r\n\r\n'],
      ['a space in a header name', 'GET / HTTP/1.1\r\nHost: desk\r\nBad Header: 1\r\nConnection: close\r\n\r\n'],
    ]
    for (const [name, request] of malformed) {
      const reply = await send(port, request)
      const responses = reply.raw.match(/HTTP\/1\.[01] \d{3}/g)?.length ?? 0
      const smuggled = responses > 1 || reply.raw.includes('/smuggled')
      checks.expect(`refuses ${name}`, !smuggled && [0, 400, 405, 505].includes(reply.status), 'medium', `status ${reply.status}, ${responses} response(s)`)
    }
    const huge = await get(port, '/', `X-Big: ${'a'.repeat(20_000)}\r\n`)
    checks.expect('refuses a 20 KB header', huge.status === 431 || huge.status === 400 || huge.status === 0, 'low', `status ${huge.status}`)
    const long = await get(port, `/${'a'.repeat(20_000)}`)
    checks.expect('refuses a 20 KB address', long.status === 414 || long.status === 431 || long.status === 400 || long.status === 0, 'low', `status ${long.status}`)

    // --- Every kind of response carries the security headers ---
    const page = await get(port, '/')
    const samples: Array<[string, Reply]> = [
      ['a page', page],
      ['the 404 page', await get(port, '/no-such-page')],
      ['a redirect', await get(port, '/terminal/')],
      ['a refused method', await send(port, 'DELETE / HTTP/1.1\r\nHost: desk\r\nConnection: close\r\n\r\n')],
      ['/api/desk', await get(port, '/api/desk')],
      ['an unchanged page (304)', await get(port, '/', `If-None-Match: ${page.headers.etag}\r\n`)],
    ]
    for (const [what, reply] of samples) {
      for (const [header, valid] of Object.entries(REQUIRED)) {
        checks.expect(`${what} sends ${header}`, valid(reply.headers[header]), header === 'content-security-policy' ? 'medium' : 'low', reply.headers[header] ? `got: ${reply.headers[header]}` : 'missing')
      }
      checks.expect(`${what} doesn't say what software serves it`, !reply.headers['x-powered-by'] && !/node|express|bun/i.test(reply.headers.server ?? ''), 'low')
    }
    checks.expect('pages say they are HTML, in UTF-8', /^text\/html; charset=utf-8$/.test(page.headers['content-type'] ?? ''), 'low', page.headers['content-type'])

    // --- What /api/desk tells the world ---
    const desk = JSON.parse((await get(port, '/api/desk')).body || '{}') as { kernel?: string }
    checks.expect("/api/desk doesn't give the exact kernel build (it tells an attacker which patches the desk has)", !/^\d+\.\d+\.\d+/.test(desk.kernel ?? ''), 'low', `kernel: ${desk.kernel}`)

    // --- Byte ranges ---
    for (const range of ['bytes=0-1,2-3', 'bytes=-0', 'bytes=99999999999999-', 'bytes=5-2', 'bytes=0-99999999999999']) {
      const reply = await get(port, '/resume.pdf', `Range: ${range}\r\n`)
      checks.expect(`a strange Range (${range}) is handled`, [200, 206, 416].includes(reply.status), 'low', `status ${reply.status}`)
    }

    // --- Errors don't show code ---
    const weird = await Promise.all(['/%', '/%E0%A4%A', '/api/%ff', '/?%', '/assets/%'].map((t) => get(port, t)))
    const traces = weird.find((r) => /\bat .+\(.+:\d+:\d+\)|Error:/.test(r.body))
    checks.expect('errors never show a stack trace', !traces, 'medium', traces?.body.slice(0, 120))
  } finally {
    stop()
  }
  return checks.findings
}
