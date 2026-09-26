// The built site served here, much as Cloudflare serves it (wrangler.jsonc):
// for the perf harness (perf/) and the browser attacks (security/), which
// need dist/ over HTTP with its real headers, and compressed the way a
// visitor gets it.
//
// It serves the prerendered site in dist/: clean URLs (/projects/butler-bot is
// dist/projects/butler-bot.html), hashed assets cached for a year and pages
// checked every time, Brotli or gzip made at build time when the browser takes
// them, byte ranges (for video), and the 404 page.
//
// dist/ is read once, when the server starts: every file small enough is kept
// in memory with its compressed copies, so a request is a lookup and a write,
// with no disk in between. Only what's in dist/ can ever be served.
import { createReadStream } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { SECURITY, securityFor } from './headers'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
}

export { SECURITY } from './headers'

export interface Options {
  /** The built site (dist/). */
  dist: string
}

export function site({ dist }: Options) {
  const files = catalog(path.resolve(dist))
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      await respond(await files, req, res)
    } catch (error) {
      console.error(error)
      if (!res.headersSent) send(res, 500, { 'content-type': 'text/plain; charset=utf-8' }, 'Something broke.')
      else res.destroy()
    }
  }
}

/** One file of dist/ as it's sent: its bytes (kept in memory if small), size and ETag. */
interface Copy {
  file: string
  size: number
  tag: string
  body: Buffer | null
}

/** A file of the site, with the compressed copies the build made of it. */
interface Entry {
  type: string
  cache: string
  /** Its security headers (server/headers.ts). */
  security: Record<string, string>
  plain: Copy
  br?: Copy
  gzip?: Copy
}

/** Files bigger than this (videos, big photos) are streamed from disk instead of kept in memory. */
const IN_MEMORY = 1024 * 1024

/** Every file in dist/, by its path from the site's root ("/index.html", "/assets/app-1a2b.js"). */
async function catalog(root: string): Promise<Map<string, Entry>> {
  const entries = new Map<string, Entry>()
  const copy = async (file: string, encoding = ''): Promise<Copy> => {
    const info = await stat(file)
    return {
      file,
      size: info.size,
      tag: `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}${encoding ? `-${encoding}` : ''}"`,
      body: info.size <= IN_MEMORY ? await readFile(file) : null,
    }
  }
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.')) await walk(file)
        continue
      }
      // Not the compressed copies (they're sent in place of their files), hidden files, source maps,
      // or Cloudflare's rules for its headers (_headers).
      if (!entry.isFile() || /\.(br|gz|map)$/.test(entry.name) || entry.name.startsWith('.') || entry.name === '_headers') continue
      const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
      const key = `/${path.relative(root, file).split(path.sep).join('/')}`
      // Vite names what's in assets/ by its contents, so those can be kept a year; pages are checked every time.
      const cache = key.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : type.startsWith('text/html') ? 'public, max-age=0, must-revalidate' : 'public, max-age=86400'
      const [plain, br, gzip] = await Promise.all([
        copy(file),
        stat(`${file}.br`).then(() => copy(`${file}.br`, 'br'), () => undefined),
        stat(`${file}.gz`).then(() => copy(`${file}.gz`, 'gzip'), () => undefined),
      ])
      entries.set(key, { type, cache, security: securityFor(key), plain, br, gzip })
    }
  }
  await walk(root)
  return entries
}

async function respond(files: Map<string, Entry>, req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const head = req.method === 'HEAD'
  // Node takes a request line without a version as HTTP/0.9, and reads on; nothing real speaks that.
  if (req.httpVersionMajor !== 1) return send(res, 505, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' }, 'HTTP/1.1 only.')
  if (req.method !== 'GET' && !head) return send(res, 405, { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' }, 'Only GET and HEAD.')

  // Only Cloudflare can see where a visitor is (edge/worker.ts); here, nothing knows, and says so.
  if (url.pathname === '/api/visitor') {
    return send(res, 200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' }, head ? '' : '{}')
  }
  if (url.pathname.startsWith('/api/')) return send(res, 404, { 'content-type': 'application/json; charset=utf-8' }, head ? '' : '{}')

  // One address per page: /projects/x (not /projects/x/, /projects/x.html or /index.html).
  const canonical = canonicalPath(url.pathname)
  if (canonical && canonical !== url.pathname) return send(res, 308, { location: canonical + url.search }, '')

  const entry = find(files, url.pathname)
  if (entry) return serveFile(req, res, entry, 200)
  const missing = files.get('/404.html')
  if (missing) return serveFile(req, res, missing, 404)
  return send(res, 404, { 'content-type': 'text/plain; charset=utf-8' }, 'Not found.')
}

/** The clean address for a path that has one, or null when it's fine (or not a page). */
export function canonicalPath(pathname: string): string | null {
  // One slash at a time: in a Location header, "//somewhere" is another site.
  let path = pathname.replace(/\/{2,}/g, '/')
  if (path === '/index.html') path = '/'
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
  if (path.endsWith('.html') && !path.startsWith('/assets/')) path = path.slice(0, -'.html'.length)
  path ||= '/'
  return path === pathname ? null : path
}

/** The file a path means, if dist/ has it: /x is x.html or x/index.html, / is index.html. */
export function find(files: Map<string, Entry>, pathname: string): Entry | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const clean = path.posix.normalize(decoded)
  const candidates = clean === '/' ? ['/index.html'] : path.posix.extname(clean) ? [clean] : [`${clean}.html`, `${clean}/index.html`]
  for (const candidate of candidates) {
    const entry = files.get(candidate)
    if (entry) return entry
  }
  return null
}

function serveFile(req: IncomingMessage, res: ServerResponse, entry: Entry, status: number) {
  // A compressed copy made at build time, if the browser takes one.
  const accepts = String(req.headers['accept-encoding'] ?? '')
  const [copy, encoding] = entry.br && /\bbr\b/.test(accepts) ? [entry.br, 'br'] : entry.gzip && /\bgzip\b/.test(accepts) ? [entry.gzip, 'gzip'] : [entry.plain, '']
  const headers: Record<string, string> = { 'content-type': entry.type, 'cache-control': entry.cache, etag: copy.tag, vary: 'Accept-Encoding', 'accept-ranges': encoding ? 'none' : 'bytes' }
  if (encoding) headers['content-encoding'] = encoding
  if (status === 200 && req.headers['if-none-match'] === copy.tag) return send(res, 304, headers, '')

  // A byte range, for video (only of files sent as they are).
  const range = !encoding && status === 200 ? /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? '')) : null
  if (range) {
    const size = copy.size
    const [start, end] = range[1] ? [Number(range[1]), range[2] ? Math.min(Number(range[2]), size - 1) : size - 1] : [Math.max(0, size - Number(range[2])), size - 1]
    if (start > end || start >= size) return send(res, 416, { ...headers, 'content-range': `bytes */${size}` }, '')
    res.writeHead(206, { ...entry.security, ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1) })
    if (req.method === 'HEAD') return res.end()
    if (copy.body) return res.end(copy.body.subarray(start, end + 1))
    return createReadStream(copy.file, { start, end }).pipe(res)
  }
  res.writeHead(status, { ...entry.security, ...headers, 'content-length': String(copy.size) })
  if (req.method === 'HEAD') return res.end()
  if (copy.body) return res.end(copy.body)
  createReadStream(copy.file).pipe(res)
}

function send(res: ServerResponse, status: number, headers: Record<string, string>, body: string) {
  res.writeHead(status, { ...SECURITY, ...headers, 'content-length': String(Buffer.byteLength(body)) })
  res.end(body)
}
