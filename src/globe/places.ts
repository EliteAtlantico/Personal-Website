// Where the stories happened, for the globe view: Toronto (and anything
// without a place, since that's home now), Kuwait City, and the one story
// that's about going from one to the other. Pure, so the static /globe page
// and the 3D globe agree, and so it can be tested.
import type { Item, Site } from '../content/types'

export interface City {
  id: 'toronto' | 'kuwait'
  name: string
  lat: number
  lng: number
}

export const CITIES: Record<City['id'], City> = {
  toronto: { id: 'toronto', name: 'Toronto', lat: 43.6532, lng: -79.3832 },
  kuwait: { id: 'kuwait', name: 'Kuwait City', lat: 29.3759, lng: 47.9774 },
}

export interface Places {
  toronto: Item[]
  kuwait: Item[]
  /** Stories about both places (the journey between them). */
  between: Item[]
}

/** Every story, in the order the visitor's front page has them (lead first), sorted into places. */
export function places(site: Site): Places {
  const out: Places = { toronto: [], kuwait: [], between: [] }
  for (const item of frontOrder(site)) {
    if (item.place === 'both') out.between.push(item)
    else if (item.place === 'kuwait') out.kuwait.push(item)
    else out.toronto.push(item)
  }
  return out
}

/** The stories in front-page order: the lead, the stories beside it, the rail, then each desk. Anything else last. */
export function frontOrder(site: Site): Item[] {
  const { config } = site
  const bySlug = new Map(site.items.map((item) => [item.slug, item]))
  const slugs = [config.lead, ...config.secondary, ...config.rail, ...config.desks.flatMap((desk) => desk.items)]
  const seen = new Set<string>()
  const ordered: Item[] = []
  for (const slug of [...slugs, ...site.items.map((item) => item.slug)]) {
    const item = bySlug.get(slug)
    if (!item || seen.has(slug)) continue
    seen.add(slug)
    ordered.push(item)
  }
  return ordered
}
