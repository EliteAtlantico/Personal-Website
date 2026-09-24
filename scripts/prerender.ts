// Runs after `vite build`: writes one static HTML file per page into dist/,
// using the built index.html (with its hashed CSS/JS links) as the template.
//   /                         → dist/index.html
//   /projects/shape-from-lighting → dist/projects/shape-from-lighting.html
//   anything else             → dist/404.html
import { createHash } from 'node:crypto'
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
  paper: ['fraunces-latin-wght-normal-core', 'newsreader-latin-wght-normal-core', 'newsreader-latin-wght-italic-core', 'ibm-plex-mono-latin-500-normal-core'],
  mono: ['ibm-plex-mono-latin-400-normal-core', 'ibm-plex-mono-latin-500-normal-core'],
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

/**
 * Each page's Content-Security-Policy: scripts come only from the site itself,
 * plus the one inline script every page starts with (index.html), allowed by
 * its hash; nothing is loaded from anywhere else, except YouTube's player once
 * a visitor asks for a video. If anything ever slipped past the escaping, the
 * browser still wouldn't run it. (What a <meta> can't say, that no other site
 * may frame the page, is a header: server/headers.ts.)
 */
const inline = [...template.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(([, code]) => `'sha256-${createHash('sha256').update(code!).digest('base64')}'`)
const CSP = [
  "default-src 'self'",
  `script-src 'self' ${inline.join(' ')}`,
  // Style attributes (written by the templates and by pretext's layouts) need this; styles can't run code.
  "style-src 'self' 'unsafe-inline'",
  // blob: for pictures of a finished canvas (src/ui/picture.ts).
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self'",
  'frame-src https://www.youtube-nocookie.com',
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ')

const pages = [...routes(site).map((route) => [route, route === '/' ? 'index.html' : `${route.slice(1)}.html`] as const), ['/__missing__', '404.html'] as const]

for (const [route, file] of pages) {
  const out = path.join(dist, file)
  const page = renderPage(site, route)
  await mkdir(path.dirname(out), { recursive: true })
  const html = injectPage(template, page)
    .replace('<meta charset="utf-8">', `<meta charset="utf-8">\n    <meta http-equiv="Content-Security-Policy" content="${CSP}">`)
    .replace('</head>', `  ${preloads(page.kind).join('\n    ')}\n  </head>`)
  if (!html.includes('http-equiv="Content-Security-Policy"')) throw new Error('prerender: no <meta charset="utf-8"> to put the Content-Security-Policy after')
  await writeFile(out, html)
}

const variants = await buildMedia(path.join(dist, 'media'))
console.log(`prerendered ${pages.length} pages (${site.items.length} stories) and ${variants} image sizes into dist/`)
