// Turns a URL into a finished page. The same function runs in three places:
// the prerender script (static HTML files), the Vite dev server, and the
// browser's router, which is why dev, production and client navigation
// always produce identical markup.
import type { Site, SiteConfig } from '../content/types'
import { renderArticle, renderNotFound } from './article'
import { renderFront } from './front'
import { esc } from './html'
import { findItem, itemPath, normalizePath, VIEW_PATHS } from './paths'
import { renderTerminal } from './terminal'

export interface Page {
  kind: 'front' | 'terminal' | 'article' | 'notfound'
  status: number
  title: string
  description: string
  html: string
  slug?: string
  /** Its one address ("/projects/butler-bot"); none for the 404 page. */
  path?: string
}

export function renderPage(site: Site, pathname: string): Page {
  const path = normalizePath(pathname)
  const { author, tagline } = site.config

  if (path === '/') {
    return {
      kind: 'front',
      status: 200,
      path: '/',
      title: `${author} | ${tagline}`,
      description: `${author}, ${tagline}. Research, projects, work and life, laid out like a front page.`,
      html: wrap('front', renderFront(site)),
    }
  }

  if (path === '/terminal') {
    return {
      kind: 'terminal',
      status: 200,
      path: '/terminal',
      title: `Terminal | ${author}`,
      description: `${author}'s site as a shell: ls, cat and open every story, or grep them all.`,
      html: wrap('terminal', renderTerminal(site)),
    }
  }

  const item = findItem(site, path)
  if (item) {
    return {
      kind: 'article',
      status: 200,
      slug: item.slug,
      path: itemPath(item),
      title: `${item.headline ?? item.title} | ${author}`,
      description: firstSentence(item.blurb) || `${item.title}, by ${author}.`,
      html: wrap('article', renderArticle(site, item)),
    }
  }

  return { kind: 'notfound', status: 404, title: `Page not found | ${author}`, description: 'This page does not exist.', html: wrap('notfound', renderNotFound(site)) }
}

/** Every URL the prerender step should write to disk. */
export const routes = (site: Site) => [...VIEW_PATHS, ...site.items.map(itemPath)]

/**
 * The colour phones and some browsers paint their toolbar: the paper's, by
 * day and by night, or the terminal's black (it's black either way).
 */
export function themeColors(kind: Page['kind']): Array<{ media?: string; color: string }> {
  if (kind === 'terminal') return [{ color: '#00050b' }]
  return [
    { media: '(prefers-color-scheme: light)', color: '#f6f2e9' },
    { media: '(prefers-color-scheme: dark)', color: '#13120f' },
  ]
}

/** The same, for a page already showing (the router changes views without a new document). */
export function setThemeColors(kind: Page['kind']) {
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.remove()
  for (const { media, color } of themeColors(kind)) {
    const meta = document.createElement('meta')
    meta.name = 'theme-color'
    if (media) meta.media = media
    meta.content = color
    document.head.append(meta)
  }
}

/** The picture a shared link carries (scripts/og.ts draws it into public/). */
export const OG_IMAGE = { path: '/og.png', width: 1200, height: 630 }

/**
 * Fills the <!--app-head--> and <!--app-html--> placeholders in index.html:
 * the title and description, and what a link to the page shows when it's
 * shared (Open Graph, which LinkedIn, iMessage, Slack and X all read).
 */
export function injectPage(template: string, page: Page, { author, url }: SiteConfig) {
  // Shared links and search engines want whole addresses.
  const address = url && page.path ? url + page.path : undefined
  const head = [
    `<title>${esc(page.title)}</title>`,
    `<meta name="description" content="${esc(page.description)}">`,
    address && `<link rel="canonical" href="${esc(address)}">`,
    `<meta property="og:site_name" content="${esc(author)}">`,
    `<meta property="og:title" content="${esc(page.title)}">`,
    `<meta property="og:description" content="${esc(page.description)}">`,
    `<meta property="og:type" content="${page.kind === 'article' ? 'article' : 'website'}">`,
    address && `<meta property="og:url" content="${esc(address)}">`,
    url && `<meta property="og:image" content="${esc(url + OG_IMAGE.path)}">`,
    url && `<meta property="og:image:width" content="${OG_IMAGE.width}">`,
    url && `<meta property="og:image:height" content="${OG_IMAGE.height}">`,
    url && `<meta property="og:image:alt" content="${esc(`${author}'s name set like a newspaper's nameplate above the Toronto skyline, drawn in text, with the CN Tower in orange`)}">`,
    `<meta name="twitter:card" content="${url ? 'summary_large_image' : 'summary'}">`,
    ...themeColors(page.kind).map(({ media, color }) => `<meta name="theme-color"${media ? ` media="${media}"` : ''} content="${color}">`),
  ]
    .filter(Boolean)
    .join('\n    ')
  return template.replace('<!--app-head-->', head).replace('<!--app-html-->', page.html)
}

const wrap = (kind: Page['kind'], html: string) => `<div class="page page--${kind}">${html}</div>`

function firstSentence(text: string) {
  const match = /^(.+?[.!?])(\s|$)/.exec(text)
  return (match?.[1] ?? text).slice(0, 200)
}
