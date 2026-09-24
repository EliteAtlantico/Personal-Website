import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import worker, { type Cf, type Env } from '../edge/worker'
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
  }
  for (const [file, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dist, file)), { recursive: true })
    await writeFile(path.join(dist, file), body)
  }
  await writeFile(path.join(os.tmpdir(), 'kc-site-secret.txt'), 'secret')
  const desk = async () => ({ live: true as const, name: 'my Arch desktop', uptime: 170_000, load: [1.15, 14.34, 33.39], cpu: 61, system: 'Linux', kernel: '7.2.6-arch2-1', cores: 24 })
  server = createServer(site({ dist, desk }))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  server.close()
  await rm(dist, { recursive: true, force: true })
})

const get = (pathname: string, headers: Record<string, string> = {}) => fetch(base + pathname, { headers, redirect: 'manual' })

describe('the desk serves the site', () => {
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

  test('/api/desk says how the desk is doing, fresh every time', async () => {
    const response = await get('/api/desk')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toMatchObject({ live: true, name: 'my Arch desktop', cpu: 61, cores: 24 })
    expect(await (await get('/api/visitor')).json()).toEqual({})
    expect((await get('/api/nothing')).status).toBe(404)
    expect((await fetch(base + '/', { method: 'POST' })).status).toBe(405)
  })
})

describe('the Worker in front of it', () => {
  const copy: Env['ASSETS'] = { fetch: async (request) => new Response(`copy of ${new URL(request.url).pathname}`) }
  const ask = (pathname: string, env: Env, cf?: Cf) => worker.fetch(Object.assign(new Request(`https://chaghouri.example${pathname}`), { cf }), env)

  test('it answers /api/visitor from what Cloudflare saw, and keeps none of it', async () => {
    const response = await ask('/api/visitor', { ASSETS: copy }, { city: 'Toronto', country: 'CA', asOrganization: 'University of Toronto', isEUCountry: '0' })
    expect(await response.json()).toEqual({ city: 'Toronto', country: 'CA', org: 'University of Toronto', eu: false })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  test('www. goes to the one address', async () => {
    const response = await worker.fetch(new Request('https://www.chaghouri.example/projects/butler-bot?from=card'), { ASSETS: copy })
    expect(response.status).toBe(308)
    expect(response.headers.get('location')).toBe('https://chaghouri.example/projects/butler-bot?from=card')
  })

  test('everything else comes from the desk while it answers', async () => {
    const response = await ask('/projects/butler-bot', { ASSETS: copy, ORIGIN: base })
    expect(await response.text()).toBe('<h1>butler</h1>')
    expect(response.headers.get('x-served-from')).toBe('desk')
    const desk = await ask('/api/desk', { ASSETS: copy, ORIGIN: base })
    expect(await desk.json()).toMatchObject({ live: true })
  })

  test("when the desk is asleep, the copy (and /api/desk says it's asleep)", async () => {
    const asleep = { ASSETS: copy, ORIGIN: 'http://127.0.0.1:9' }
    const response = await ask('/projects/butler-bot', asleep)
    expect(await response.text()).toBe('copy of /projects/butler-bot')
    expect(response.headers.get('x-served-from')).toBe('copy')
    expect(await (await ask('/api/desk', asleep)).json()).toEqual({ live: false })
    // Without a desk configured at all (before there's a domain), it's always the copy.
    expect((await ask('/', { ASSETS: copy })).headers.get('x-served-from')).toBe('copy')
  })
})
