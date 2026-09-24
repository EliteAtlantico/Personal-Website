// The globe, as the page has it before JavaScript: a host element that
// src/globe draws into. It holds a line saying where the stories happened
// (all that shows without JavaScript or WebGL), a caption naming the story
// being pointed at, and a list of the stories for keyboard and screen-reader
// users (focusing one turns the globe to its dot). The front page's tile is
// here (the tile is itself the host); the terminal's pane and its full-screen
// globe come from src/terminal.
import type { Item, Site } from '../content/types'
import { CITIES, places } from '../globe/places'
import { esc } from './html'
import { deskName, itemPath } from './paths'

/** "15 stories in Toronto, 7 in Kuwait City and 1 about the move between them." */
export function globeSummary(site: Site) {
  const { toronto, kuwait, between } = places(site)
  const n = (count: number, noun = 'stories') => `${count} ${count === 1 ? noun.replace(/ies$/, 'y') : noun}`
  return `${n(toronto.length)} in ${CITIES.toronto.name}, ${kuwait.length} in ${CITIES.kuwait.name}${between.length ? ` and ${between.length} about the move between them` : ''}.`
}

export const GLOBE_HINT = 'Drag to turn it; pick a dot to read that story.'

/** Every story, a link to its page, for the keyboard and screen readers. */
function storyLinks(site: Site) {
  const { toronto, kuwait, between } = places(site)
  const link = (item: Item, where: string) =>
    `<li><a href="${itemPath(item)}" data-slug="${esc(item.slug)}">${esc(item.title)}<span class="sr-only">, ${esc(deskName(site, item))}, ${esc(where)}</span></a></li>`
  const list = [
    ...toronto.map((item) => link(item, CITIES.toronto.name)),
    ...kuwait.map((item) => link(item, CITIES.kuwait.name)),
    ...between.map((item) => link(item, `between ${CITIES.kuwait.name} and ${CITIES.toronto.name}`)),
  ]
  return `<ul class="globe__stories" aria-label="The stories, by where they happened">${list.join('')}</ul>`
}

/**
 * The front page's tile, across the lead column under the stories beside the
 * lead: what it is on the left, the globe on the right. The tile is the
 * globe's host.
 */
export function globeTile(site: Site) {
  return `<section class="tile tile--globe globe" data-globe aria-labelledby="globe-h">
  <div class="tile--globe__text">
    <p class="kicker"><span class="kicker__desk">The map</span><span class="kicker__meta">${site.items.length} stories</span></p>
    <h3 class="tile__headline" id="globe-h">Where it happened</h3>
    <p class="tile__dek">${esc(globeSummary(site))}</p>
    <p class="globe__caption" aria-hidden="true">${esc(GLOBE_HINT)}</p>
    ${storyLinks(site)}
  </div>
</section>`
}
