// A full story page: headline, fact box (the part recruiters scan), media,
// the Markdown deep-dive, and related stories chosen by shared tags.
import { relatedItems } from '../content/related'
import type { Item, Media, Site } from '../content/types'
import { footer, masthead } from './chrome'
import { esc, join } from './html'
import { coverFigure, kicker, tile } from './tiles'

export function renderArticle(site: Site, item: Item) {
  const hasMain = item.bodyHtml !== '' || item.media.length > 0 || item.cover !== undefined
  return `${masthead(site, 'compact')}
<main id="main" class="story-page">
  <article class="story" data-slug="${esc(item.slug)}">
    <header class="story__head">
      <a class="story__back" href="/">← Front page</a>
      ${kicker(site, item)}
      <h1 class="story__headline" tabindex="-1">${esc(item.headline ?? item.title)}</h1>
      ${join([
        item.blurb && !item.excerpt && `<p class="story__dek">${esc(item.blurb)}</p>`,
        `<p class="story__byline">By ${esc(site.config.author)}${item.org ? ` <span aria-hidden="true">·</span> ${esc(item.org)}` : ''}</p>`,
      ])}
    </header>
    <div class="story__grid${hasMain ? '' : ' story__grid--facts'}">
      ${hasMain ? `<div class="story__main">${item.cover ? coverFigure(item.cover, 'story__cover', 3) : ''}${item.media.map(mediaBlock).join('')}${item.bodyHtml && `<div class="prose">${item.bodyHtml}</div>`}</div>` : ''}
      ${factbox(item)}
    </div>
  </article>
  ${related(site, item)}
</main>
${footer(site)}`
}

export function renderNotFound(site: Site) {
  return `${masthead(site, 'compact')}
<main id="main" class="story-page">
  <article class="story story--missing">
    <header class="story__head">
      <p class="kicker"><span class="kicker__desk">Correction</span></p>
      <h1 class="story__headline" tabindex="-1">Stop the presses: this page doesn't exist.</h1>
      <p class="story__dek">It may have moved, or it never ran. The <a href="/">front page</a> has everything that did.</p>
    </header>
  </article>
</main>
${footer(site)}`
}

function factbox(item: Item) {
  const rows: Array<[string, string]> = []
  if (item.role) rows.push(['Role', esc(item.role)])
  if (item.dates) rows.push(['When', esc(item.dates)])
  const where = [item.org, item.remote ? 'Remote' : undefined].filter(Boolean).join(' · ')
  if (where) rows.push(['Where', esc(where)])
  if (item.team.length) rows.push(['Team', esc(item.team.join(', '))])
  if (item.publication) {
    const { venue, title, position } = item.publication
    rows.push(['Published', `${esc(venue)}, <cite>${esc(title)}</cite>${position ? ` (${esc(authorPosition(position))})` : ''}`])
  }
  if (item.paper) rows.push(['Paper', `<cite>${esc(item.paper)}</cite>`])
  if (item.datasets.length) rows.push(['Data', esc(item.datasets.join(', '))])

  if (!rows.length && !item.outcomes.length && !item.stack.length && !item.links.length) return ''
  return `<aside class="factbox" aria-labelledby="facts-${esc(item.slug)}">
  <h2 class="factbox__title" id="facts-${esc(item.slug)}">The facts</h2>
  ${join([
    rows.length && `<dl class="factbox__rows">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>`,
    item.outcomes.length &&
      `<h3 class="factbox__label">Results</h3><ul class="factbox__outcomes">${item.outcomes.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>`,
    item.stack.length && `<h3 class="factbox__label">Built with</h3><ul class="chips">${item.stack.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`,
    item.links.length &&
      `<p class="factbox__links">${item.links.map((l) => `<a href="${esc(l.url)}" rel="noopener">${esc(l.label)} <span aria-hidden="true">↗</span></a>`).join('')}</p>`,
  ])}
</aside>`
}

/** "3 of 5" → "3rd of 5 authors" */
function authorPosition(position: string) {
  const match = /^(\d+) of (\d+)$/.exec(position)
  if (!match) return position
  const n = Number(match[1])
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
  return `${n}${suffix} of ${match[2]} authors`
}

function mediaBlock(media: Media) {
  if (media.type === 'youtube') {
    // A click-to-load facade: nothing is fetched from YouTube until the visitor asks for it.
    const label = media.title ? `Play “${media.title}”` : 'Play video'
    return `<figure class="media media--video">
  <a class="video" href="https://www.youtube.com/watch?v=${esc(media.id)}" data-youtube="${esc(media.id)}" aria-label="${esc(label)}">
    <span class="video__play" aria-hidden="true">▶</span>
    <span class="video__label">${esc(label)}</span>
    <span class="video__note">Loads YouTube (privacy-enhanced mode) only when you click</span>
  </a>
</figure>`
  }
  return `<figure class="media"><img src="${esc(media.src)}" alt="${esc(media.alt)}" loading="lazy" decoding="async">${
    media.caption ? `<figcaption>${esc(media.caption)}</figcaption>` : ''
  }</figure>`
}

function related(site: Site, item: Item) {
  const picks = relatedItems(site, item)
  if (!picks.length) return ''
  return `<section class="related desk" aria-labelledby="related-h">
  <h2 class="desk__name" id="related-h">Related stories</h2>
  <div class="desk__stories"><div class="desk__grid">${picks.map((other) => tile(site, other)).join('')}</div></div>
</section>`
}
