// Runs after `vite build`: writes one static HTML file per page into dist/,
// using the built index.html (with its hashed CSS/JS links) as the template.
//   /                         → dist/index.html
//   /projects/shape-from-lighting → dist/projects/shape-from-lighting.html
//   anything else             → dist/404.html
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { loadSite } from '../src/content/load'
import { injectPage, renderPage, routes } from '../src/render/document'
import { buildMedia } from './media'

const dist = path.resolve('dist')
const template = await readFile(path.join(dist, 'index.html'), 'utf8')
const site = await loadSite({ includeDrafts: false, optimizeMedia: true })

const pages = [...routes(site).map((route) => [route, route === '/' ? 'index.html' : `${route.slice(1)}.html`] as const), ['/__missing__', '404.html'] as const]

for (const [route, file] of pages) {
  const out = path.join(dist, file)
  await mkdir(path.dirname(out), { recursive: true })
  await writeFile(out, injectPage(template, renderPage(site, route)))
}

const variants = await buildMedia(path.join(dist, 'media'))
console.log(`prerendered ${pages.length} pages (${site.items.length} stories) and ${variants} image sizes into dist/`)
