// Related stories: the ones sharing the most tags (a shared section breaks
// ties). Hobbies only relate to other hobbies. Used by the paper's article
// pages and the terminal's reader alike.
import type { Item, Site } from './types'

export function relatedItems(site: Site, item: Item, count = 3): Item[] {
  return site.items
    .filter((other) => other.slug !== item.slug && other.section !== 'now' && (other.section !== 'hobbies' || item.section === 'hobbies'))
    .map((other) => ({
      other,
      score: other.tags.filter((tag) => item.tags.includes(tag)).length * 2 + (other.section === item.section ? 1 : 0),
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.other.slug.localeCompare(b.other.slug))
    .slice(0, count)
    .map(({ other }) => other)
}
