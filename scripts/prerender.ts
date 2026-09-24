// Runs after `vite build`: writes one static HTML file per page into dist/,
// using the built index.html (with its hashed CSS/JS links) as the template.
//   /                         → dist/index.html
//   /projects/shape-from-lighting → dist/projects/shape-from-lighting.html
//   anything else             → dist/404.html
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { loadSite } from '../src/content/load'
import { injectPage, renderPage, routes, type Page } from '../src/render/document'
import { buildMedia } from './media'

const dist = path.resolve('dist')
const template = await readFile(path.join(dist, 'index.html'), 'utf8')
const site = await loadSite({ includeDrafts: false, optimizeMedia: true })
const assets = await readdir(path.join(dist, 'assets'))

/**
 * What a page can't show itself without, asked for from its <head> instead
 * of once the stylesheet and script have run: the fonts it waits for
 * (src/layout/fonts.ts: the paper's, or the terminal's monospace), and on the
 * terminal, the chunks its script is about to import. They go after the
 * stylesheet, which the first paint needs before anything.
 */
const FONTS = {
  paper: ['fraunces-latin-wght-normal', 'newsreader-latin-wght-normal', 'newsreader-latin-wght-italic', 'ibm-plex-mono-latin-500-normal'],
  mono: ['ibm-plex-mono-latin-400-normal', 'ibm-plex-mono-latin-500-normal'],
}

function asset(name: string, extension: string) {
  const file = assets.find((f) => f.startsWith(`${name}-`) && f.endsWith(extension))
  if (!file) throw new Error(`prerender: nothing in dist/assets/ like ${name}-*${extension} to preload`)
  return `/assets/${file}`
}

function preloads(kind: Page['kind']) {
  const fonts = FONTS[kind === 'terminal' ? 'mono' : 'paper'].map((name) => `<link rel="preload" href="${asset(name, '.woff2')}" as="font" type="font/woff2" crossorigin>`)
  const chunks = kind === 'terminal' ? ['terminal', 'globe'].map((name) => `<link rel="modulepreload" href="${asset(name, '.js')}">`) : []
  return [...fonts, ...chunks]
}

const pages = [...routes(site).map((route) => [route, route === '/' ? 'index.html' : `${route.slice(1)}.html`] as const), ['/__missing__', '404.html'] as const]

for (const [route, file] of pages) {
  const out = path.join(dist, file)
  const page = renderPage(site, route)
  await mkdir(path.dirname(out), { recursive: true })
  await writeFile(out, injectPage(template, page).replace('</head>', `  ${preloads(page.kind).join('\n    ')}\n  </head>`))
}

const variants = await buildMedia(path.join(dist, 'media'))
console.log(`prerendered ${pages.length} pages (${site.items.length} stories) and ${variants} image sizes into dist/`)
