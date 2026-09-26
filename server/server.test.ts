import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import worker, { type Cf } from '../edge/worker'
import { headersFile, HSTS, SECURITY, SHARED } from './headers'
import { canonicalPath, site } from './site'

let dist: string
let server: Server
let base: string

beforeAll(async () => {
  dist = await mkdtemp(path.join(os.tmpdir(), 'kc-site-'))
  const files: Record<string, string | Buffer> = {
    'index.html': '<h1>front</h1>',
    'terminal.html': '<h1>terminal</h1>',
    'projects/butler-bot.html': '<h1>butler</h1>',
    '404.html': '<h1>missing</h1>',
    'assets/app-1a2b.js': 'console.log("app")',
    'assets/app-1a2b.js.gz': gzipSync('console.log("app")'),
    'media/clip.mp4': Buffer.from('0123456789'),
    'og.png': Buffer.from('png'),
    _headers: headersFile(),
  }
  for (const [file, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dist, file)), { recursive: true })
    await writeFile(path.join(dist, file), body)
  }
  await writeFile(path.join(os.tmpdir(), 'kc-site-secret.txt'), 'secret')
  server = createServer(site({ dist }))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  server.close()
  await rm(dist, { recursive: true, force: true })
})

const get = (pathname: string, headers: Record<string, string> = {}) => fetch(base + pathname, { headers, redirect: 'manual' })

describe('the local server serves the site', () => {
  test('clean addresses: / and /projects/x are pages; the page file names redirect to them', async () => {
    expect(await (await get('/')).text()).toBe('<h1>front</h1>')
    expect(await (await get('/projects/butler-bot')).text()).toBe('<h1>butler</h1>')
    const redirect = await get('/projects/butler-bot.html')
    expect(redirect.status).toBe(308)
    expect(redirect.headers.get('location')).toBe('/projects/butler-bot')
    expect(canonicalPath('/terminal/')).toBe('/terminal')
    expect(canonicalPath('/index.html')).toBe('/')
  })

  test('a page that does not exist is the 404 page, with a 404', async () => {
    const response = await get('/projects/nothing-here')
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('<h1>missing</h1>')
  })

  test('nothing outside dist/ can be reached', async () => {
    for (const sneaky of ['/../kc-site-secret.txt', '/%2e%2e/kc-site-secret.txt', '/assets/..%2f..%2fkc-site-secret.txt']) {
      const response = await get(sneaky)
      expect(await response.text()).not.toContain('secret')
    }
  })

  test('hashed assets are kept for a year and pages are checked every time; both say what they are', async () => {
    const asset = await get('/assets/app-1a2b.js')
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(asset.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    const page = await get('/')
    expect(page.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate')
    expect(page.headers.get('x-content-type-options')).toBe('nosniff')
  })

  test('the gzip made at build time goes to browsers that take it, and an unchanged file is a 304', async () => {
    const zipped = await get('/assets/app-1a2b.js', { 'accept-encoding': 'gzip' })
    expect(zipped.headers.get('content-encoding')).toBe('gzip')
    expect(await zipped.text()).toBe('console.log("app")')
    const again = await get('/assets/app-1a2b.js', { 'accept-encoding': 'gzip', 'if-none-match': zipped.headers.get('etag')! })
    expect(again.status).toBe(304)
  })

  test('video comes in byte ranges', async () => {
    const part = await get('/media/clip.mp4', { range: 'bytes=2-5' })
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(await part.text()).toBe('2345')
    expect((await get('/media/clip.mp4', { range: 'bytes=20-' })).status).toBe(416)
  })

  test('/api/visitor knows nothing here (only Cloudflare can see where a visitor is); other methods are refused', async () => {
    expect(await (await get('/api/visitor')).json()).toEqual({})
    expect((await get('/api/desk')).status).toBe(404)
    expect((await fetch(base + '/', { method: 'POST' })).status).toBe(405)
  })

  test("the picture a shared link carries may be shown by other sites; nothing else may; Cloudflare's rules aren't a page", async () => {
    expect((await get('/og.png')).headers.get('cross-origin-resource-policy')).toBeNull()
    expect((await get('/')).headers.get('cross-origin-resource-policy')).toBe('same-origin')
    expect((await get('/_headers')).status).toBe(404)
  })
})

describe("Cloudflare's _headers file", () => {
  test('every file gets every security header, and HSTS; the shared picture drops only the embedding rule', () => {
    const file = headersFile()
    const [all, ...shared] = file.split(/\n(?=\/)/)
    expect(all!.split('\n')[0]).toBe('/*')
    for (const [name, value] of Object.entries(SECURITY)) expect(all).toContain(`  ${name}: ${value}\n`)
    expect(all).toContain(`  strict-transport-security: ${HSTS}`)
    expect(shared.map((rule) => rule.split('\n')[0])).toEqual(SHARED)
    for (const rule of shared) expect(rule.trim().split('\n').slice(1)).toEqual(['  ! cross-origin-resource-policy'])
  })
})

describe('the Worker', () => {
  const ask = (pathname: string, cf?: Cf, method = 'GET') => worker.fetch(Object.assign(new Request(`https://chaghouri.example${pathname}`, { method }), { cf }))

  test('it answers /api/visitor from what Cloudflare saw, and keeps none of it', async () => {
    const response = await ask('/api/visitor', { city: 'Toronto', country: 'CA', asOrganization: 'University of Toronto', isEUCountry: '0' })
    expect(await response.json()).toEqual({ city: 'Toronto', country: 'CA', org: 'University of Toronto', eu: false })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('strict-transport-security')).toBe(HSTS)
  })

  test('anything else sent its way is a 404, and only GET and HEAD are answered', async () => {
    expect((await ask('/api/desk')).status).toBe(404)
    expect((await ask('/projects/butler-bot')).status).toBe(404)
    expect((await ask('/api/visitor', undefined, 'POST')).status).toBe(405)
  })
})
