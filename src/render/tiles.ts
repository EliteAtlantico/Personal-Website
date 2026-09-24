// A "tile" is one story on the front page. The whole tile is a single link to
// the article, so it works with no JavaScript at all.
import type { Cover, Item, Site } from '../content/types'
import { esc, formatShortDate, join } from './html'
import { deskName, itemPath } from './paths'

export type TileVariant = 'lead' | 'story' | 'brief' | 'now' | 'rail'

export function tile(site: Site, item: Item, variant: TileVariant = 'story', level: 2 | 3 = 3) {
  const headline = item.headline ?? item.title
  const byline = item.headline && item.headline !== item.title ? item.title : item.org
  const h = `h${level}`
  return `<article class="tile tile--${variant}" data-slug="${esc(item.slug)}"${item.span > 1 ? ` data-span="${item.span}"` : ''}>
  <a class="tile__link" href="${itemPath(item)}">
    ${item.cover && variant !== 'now' ? coverFigure(item.cover, 'tile__cover', item.span) : ''}
    ${kicker(site, item)}
    <${h} class="tile__headline">${esc(headline)}</${h}>
    ${join([
      item.blurb && `<p class="tile__dek">${esc(item.blurb)}</p>`,
      item.excerpt && `<p class="tile__more">Continued inside →</p>`,
      byline && variant !== 'brief' && variant !== 'now' && `<p class="tile__byline">${esc(byline)}</p>`,
    ])}
  </a>
</article>`
}

export function kicker(site: Site, item: Item) {
  const stamp = stampOf(item)
  const meta = item.section === 'now' && item.updated ? `Updated ${formatShortDate(item.updated)}` : item.dates
  return `<p class="kicker"><span class="kicker__desk">${esc(deskName(site, item))}</span>${join([
    meta && `<span class="kicker__meta">${esc(meta)}</span>`,
    stamp && `<span class="stamp stamp--${stamp.kind}">${stamp.label}</span>`,
  ])}</p>`
}

/**
 * A photo or looping video with its aspect ratio reserved up front, so the
 * front-page layout knows its height before it loads. Videos start paused;
 * enhance.ts plays them while visible (unless the visitor prefers reduced motion).
 */
export function coverFigure(cover: Cover, className: string, span = 1, sizesHint?: string) {
  const ratio = `aspect-ratio: ${cover.width} / ${cover.height}`
  if (cover.kind === 'video') {
    return `<figure class="${className}" style="${ratio}">
      <video src="${esc(cover.src)}"${cover.poster ? ` poster="${esc(cover.poster)}"` : ''} muted loop playsinline preload="none" aria-label="${esc(cover.alt)}" data-autoplay></video>
    </figure>`
  }
  const sizes = sizesHint ?? (span > 1 ? '(max-width: 880px) 100vw, 640px' : '(max-width: 880px) 100vw, 400px')
  return `<figure class="${className}" style="${ratio}">
    <img src="${esc(cover.src)}"${cover.srcset ? ` srcset="${esc(cover.srcset)}" sizes="${sizes}"` : ''} width="${cover.width}" height="${cover.height}" alt="${esc(cover.alt)}" loading="lazy" decoding="async">
  </figure>`
}

function stampOf(item: Item): { kind: string; label: string } | undefined {
  if (item.draft) return { kind: 'draft', label: 'Draft' }
  if (item.publication?.status === 'published') return { kind: 'published', label: 'Published' }
  if (item.status === 'in-progress') return { kind: 'live', label: 'In progress' }
  if (item.status === 'paused') return { kind: 'paused', label: 'Paused' }
  return undefined
}
