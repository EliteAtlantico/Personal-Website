// The front page for one visitor: the same stories, reordered. The lead story
// and the ones beside it stay as content/site.json has them (they're the
// editor's picks); what moves is the desk this kind of visitor wants most (to
// the top), and the stories inside each desk, by how much this kind of visitor
// cares about them (each story's `audience` weights) and, for visitors in
// Kuwait, whether they happened there.
import type { Item, Section, Site } from '../content/types'
import type { Decision, Persona, Place } from './decide'

/** The desk each kind of visitor wants first, found by what it holds. */
const FIRST: Record<Persona, Section[]> = { recruiter: ['work'], research: ['research'], dev: ['projects'] }

/** The site as this visitor's front page lays it out (the same object if nothing changes). */
export function personalizeSite(site: Site, decision: Decision): Site {
  const { persona, place } = decision
  if (!persona && !place) return site
  const bySlug = new Map(site.items.map((item) => [item.slug, item]))
  const holds = (sections: Section[]) => (desk: { items: string[] }) => desk.items.some((slug) => sections.includes(bySlug.get(slug)?.section as Section))

  // Stories the visitor cares about most first; ties keep the editor's order (the sort is stable).
  const weight = (slug: string) => {
    const item = bySlug.get(slug)
    if (!item) return 0
    return (persona ? item.audience[persona] * 2 : 0) + (place && from(item, place) ? 3 : 0)
  }
  let desks = site.config.desks.map((desk) => ({ ...desk, items: [...desk.items].sort((a, b) => weight(b) - weight(a)) }))
  const at = persona ? desks.findIndex(holds(FIRST[persona])) : -1
  if (at > 0) desks = [desks[at]!, ...desks.slice(0, at), ...desks.slice(at + 1)]
  return { ...site, config: { ...site.config, desks } }
}

/** The desk that now comes first, by name ("Industry"), if the visitor's kind moved one. */
export function firstDesk(site: Site, decision: Decision) {
  if (!decision.persona) return undefined
  const sections = FIRST[decision.persona]
  const bySlug = new Map(site.items.map((item) => [item.slug, item]))
  return site.config.desks.find((desk) => desk.items.some((slug) => sections.includes(bySlug.get(slug)?.section as Section)))?.name
}

const from = (item: Item, place: Place) => item.place === place || item.place === 'both'
