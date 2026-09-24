import { createReadStream, existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { CONTENT_DIR, MEDIA_DIR, loadSite } from './src/content/load'

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

export default defineConfig({
  plugins: [content()],
  build: { target: 'es2022' },
})
