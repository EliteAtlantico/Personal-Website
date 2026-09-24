// The front page: a lead story (with its opening paragraphs "jumping" onto the
// front page, newspaper style), a right-hand rail, then one "desk" per section.
// content/site.json decides what goes where; anything it forgets about still
// shows up in a final "More" desk, so an item can never silently disappear.
import type { Desk, Item, Site } from '../content/types'
import { footer, masthead } from './chrome'
import { globeTile } from './globe'
import { esc } from './html'
import { itemPath } from './paths'
import { tile } from './tiles'

export function renderFront(site: Site) {
  const bySlug = new Map(site.items.map((item) => [item.slug, item]))
  const used = new Set<string>()
  const take = (slug: string) => {
    const item = bySlug.get(slug)
    if (!item || used.has(slug)) return []
    used.add(slug)
    return [item]
  }

  const lead = take(site.config.lead)[0]
  const secondary = site.config.secondary.flatMap(take)
  const rail = site.config.rail.flatMap(take)
  const desks: Array<{ desk: Desk; items: Item[] }> = site.config.desks.map((desk) => ({ desk, items: desk.items.flatMap(take) }))
  const leftovers = site.items.filter((item) => !used.has(item.slug))
  if (leftovers.length) desks.push({ desk: { name: 'More', items: [] }, items: leftovers })

  return `${masthead(site, 'full', 'paper')}
<main id="main" class="front">
  ${lead ? `<section class="lead" aria-label="Top stories">
    ${tile(site, lead, 'lead', 2)}
    ${jump(lead)}
    ${secondary.length ? `<div class="lead__secondary">${secondary.map((item) => tile(site, item)).join('')}</div>` : ''}
    ${globeTile(site)}
  </section>` : ''}
  <aside class="rail" aria-label="Also on the front page">
    ${bio(site)}
    ${rail.map((item) => tile(site, item, item.section === 'now' ? 'now' : 'rail')).join('')}
  </aside>
  ${desks
    .filter(({ items }) => items.length)
    .map(({ desk, items }) => deskSection(site, desk, items))
    .join('')}
</main>
${footer(site)}`
}

/** The lead story's opening paragraphs, set on the front page like a newspaper jump. */
function jump(item: Item) {
  if (!item.lede.length) return ''
  return `<div class="jump" data-slug="${esc(item.slug)}">
    <div class="jump__text">${item.lede.map((p) => `<p>${esc(p)}</p>`).join('')}</div>
  </div>
  <p class="jump__more"><a href="${itemPath(item)}">Continued inside →</a></p>`
}

/** "About the editor": the bio, which stage-2 layout sets inside a microchip silhouette. */
function bio(site: Site) {
  if (!site.bio) return ''
  return `<section class="bio" aria-labelledby="bio-h">
    <h2 class="kicker bio__label" id="bio-h"><span class="kicker__desk">${esc(site.bio.title)}</span></h2>
    <div class="bio__chip"><p class="bio__text">${esc(site.bio.text)}</p></div>
  </section>`
}

function deskSection(site: Site, desk: Desk, items: Item[]) {
  const id = `desk-${desk.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  const variant = desk.variant === 'briefs' ? 'brief' : 'story'
  return `<section class="desk desk--${variant}" aria-labelledby="${id}">
  <h2 class="desk__name" id="${id}">${esc(desk.name)}</h2>
  <div class="desk__stories"><div class="desk__grid">
    ${items.map((item) => tile(site, item, variant)).join('')}
  </div></div>
</section>`
}
