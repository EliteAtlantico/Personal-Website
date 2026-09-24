// Turns a URL into a finished page. The same function runs in three places:
// the prerender script (static HTML files), the Vite dev server, and the
// browser's router, which is why dev, production and client navigation
// always produce identical markup.
import type { Site } from '../content/types'
import { renderArticle, renderNotFound } from './article'
import { renderFront } from './front'
import { esc } from './html'
import { findItem, itemPath, normalizePath } from './paths'

export interface Page {
  kind: 'front' | 'article' | 'notfound'
  status: number
  title: string
  description: string
  html: string
  slug?: string
}

export function renderPage(site: Site, pathname: string): Page {
  const path = normalizePath(pathname)
  const { author, tagline } = site.config

  if (path === '/') {
    return {
      kind: 'front',
      status: 200,
      title: `${author} | ${tagline}`,
      description: `${author}, ${tagline}. Research, projects, work and life, laid out like a front page.`,
      html: wrap('front', renderFront(site)),
    }
  }

  const item = findItem(site, path)
  if (item) {
    return {
      kind: 'article',
      status: 200,
      slug: item.slug,
      title: `${item.headline ?? item.title} | ${author}`,
      description: firstSentence(item.blurb) || `${item.title}, by ${author}.`,
      html: wrap('article', renderArticle(site, item)),
    }
  }

  return { kind: 'notfound', status: 404, title: `Page not found | ${author}`, description: 'This page does not exist.', html: wrap('notfound', renderNotFound(site)) }
}

/** Every URL the prerender step should write to disk. */
export const routes = (site: Site) => ['/', ...site.items.map(itemPath)]

/** Fills the <!--app-head--> and <!--app-html--> placeholders in index.html. */
export function injectPage(template: string, page: Page) {
  const head = [
    `<title>${esc(page.title)}</title>`,
    `<meta name="description" content="${esc(page.description)}">`,
    `<meta property="og:title" content="${esc(page.title)}">`,
    `<meta property="og:description" content="${esc(page.description)}">`,
    `<meta property="og:type" content="${page.kind === 'article' ? 'article' : 'website'}">`,
  ].join('\n    ')
  return template.replace('<!--app-head-->', head).replace('<!--app-html-->', page.html)
}

const wrap = (kind: Page['kind'], html: string) => `<div class="page page--${kind}">${html}</div>`

function firstSentence(text: string) {
  const match = /^(.+?[.!?])(\s|$)/.exec(text)
  return (match?.[1] ?? text).slice(0, 200)
}
