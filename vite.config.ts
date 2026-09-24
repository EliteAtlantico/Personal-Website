import { createReadStream, existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { feature } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import { defineConfig, type Plugin } from 'vite'
import { CONTENT_DIR, MEDIA_DIR, loadSite } from './src/content/load'
import { deskNow } from './server/site'
import { DOTS, landBits, type Polygons } from './src/globe/land'

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
}

const VIRTUAL_ID = 'virtual:content'
const RESOLVED_ID = `\0${VIRTUAL_ID}`

/**
 * Makes content/ available to the app as `import site from 'virtual:content'`,
 * and makes the dev server return fully rendered pages (the same HTML the
 * production prerender step writes), instead of an empty shell.
 */
function content(): Plugin {
  let dev = false
  return {
    name: 'chaghouri-content',
    configResolved(config) {
      dev = config.command === 'serve'
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined
    },
    async load(id) {
      if (id !== RESOLVED_ID) return undefined
      // Drafts are visible while writing, and never shipped.
      return `export default ${JSON.stringify(await loadSite({ includeDrafts: dev, optimizeMedia: !dev }))}`
    },
    configureServer(server) {
      server.watcher.add(CONTENT_DIR)
      server.watcher.on('all', (_event, file) => {
        if (!file.startsWith(CONTENT_DIR)) return
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID)
        if (mod) server.moduleGraph.invalidateModule(mod)
        server.ws.send({ type: 'full-reload' })
      })

      // What Cloudflare sees of a visitor (city, network) comes from the edge Worker in production
      // (edge/worker.ts). Here there's nothing to see; ?debug&city=…&org=… stands in for it.
      server.middlewares.use('/api/visitor', (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.end('{}')
      })
      // How the desk is doing (server/site.ts), from this computer while developing.
      server.middlewares.use('/api/desk', async (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(await deskNow()))
      })

      // Photos and videos straight from content/media/ (the build makes resized copies instead).
      server.middlewares.use('/media', (req, res, next) => {
        const file = path.join(MEDIA_DIR, decodeURIComponent((req.url ?? '/').split('?')[0]!))
        if (!file.startsWith(MEDIA_DIR + path.sep) || !existsSync(file) || !statSync(file).isFile()) return next()
        res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream')
        createReadStream(file).pipe(res)
      })

      server.middlewares.use(async (req, res, next) => {
        const url = req.originalUrl ?? req.url ?? '/'
        const pathname = new URL(url, 'http://localhost').pathname
        const wantsPage =
          req.method === 'GET' && req.headers.accept?.includes('text/html') && !pathname.startsWith('/@') && !/\.(?!html$)[a-z0-9]+$/i.test(pathname)
        if (!wantsPage) return next()
        try {
          const template = await server.transformIndexHtml(url, await readFile(path.resolve('index.html'), 'utf8'))
          const { renderPage, injectPage } = (await server.ssrLoadModule('/src/render/document.ts')) as typeof import('./src/render/document')
          const page = renderPage(await loadSite({ includeDrafts: true }), pathname)
          // In dev the CSS normally arrives with the JavaScript, a moment after the first paint.
          // Link it as well, so the first paint is styled like production (main.ts drops the link).
          const html = injectPage(template, page).replace('</head>', '  <link rel="stylesheet" href="/src/styles/main.css" data-dev-css>\n  </head>')
          res.statusCode = page.status
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          res.end(html)
        } catch (error) {
          server.ssrFixStacktrace(error as Error)
          next(error)
        }
      })
    },
  }
}

/**
 * The globe's land as `import land from 'virtual:land'`: one bit per dot
 * (src/globe/land.ts), worked out from Natural Earth's coastlines once per
 * build instead of in every visitor's browser.
 */
function land(): Plugin {
  const ID = 'virtual:land'
  let bits: string | undefined
  return {
    name: 'chaghouri-land',
    resolveId: (id) => (id === ID ? `\0${ID}` : undefined),
    async load(id) {
      if (id !== `\0${ID}`) return undefined
      if (!bits) {
        const file = createRequire(import.meta.url).resolve('world-atlas/land-110m.json')
        const topology = JSON.parse(await readFile(file, 'utf8')) as Topology<{ land: GeometryCollection }>
        const polygons: Polygons = feature(topology, topology.objects.land).features.flatMap(({ geometry }) =>
          geometry.type === 'MultiPolygon' ? geometry.coordinates : geometry.type === 'Polygon' ? [geometry.coordinates] : [],
        )
        bits = landBits(polygons, DOTS)
      }
      return `export default ${JSON.stringify(bits)}`
    },
  }
}

/**
 * pretext works out the direction of right-to-left text (bidi levels) in
 * everything it prepares, as extra information for renderers that draw
 * mixed-direction text themselves. It never uses them itself, and neither
 * does this site (it's left-to-right English throughout), so its Unicode
 * tables and that work, done for every string on every page, are left out:
 * pretext's bidi module is swapped for one with nothing to report, which it
 * already allows for.
 */
function noBidi(): Plugin {
  const ID = '\0pretext-no-bidi'
  return {
    name: 'chaghouri-no-bidi',
    enforce: 'pre',
    resolveId: (source, importer) => (source === './bidi.js' && importer?.includes('@chenglou/pretext') ? ID : undefined),
    load: (id) => (id === ID ? 'export function computeSegmentLevels() { return null }' : undefined),
  }
}

export default defineConfig({
  plugins: [content(), land(), noBidi()],
  build: {
    target: 'es2022',
    // Source maps only for profiling (perf/frames.ts), and never linked from the code.
    sourcemap: process.env.PERF_SOURCEMAP ? 'hidden' : false,
    // Every browser the site supports preloads modules itself, and the lazy chunks (the terminal,
    // the globe) have nothing of their own to preload, so neither the polyfill nor the helper ships.
    modulePreload: false,
  },
})
