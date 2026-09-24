// URL scheme: "/" is the front page, every item lives at /<section>/<slug>,
// except the "Now" item, which is simply /now.
import type { Item, Site } from '../content/types'

export const itemPath = (item: Item) => (item.section === 'now' ? '/now' : `/${item.section}/${item.slug}`)

/** "/projects/kc-bots/", "/projects/kc-bots.html" and "/projects/kc-bots" are the same page. */
export function normalizePath(pathname: string) {
  let path = decodeURI(pathname).replace(/\/index\.html$/, '/').replace(/\.html$/, '')
  if (path.length > 1) path = path.replace(/\/+$/, '')
  return path || '/'
}

export const findItem = (site: Site, pathname: string) => {
  const path = normalizePath(pathname)
  return site.items.find((item) => itemPath(item) === path)
}

/** Pages that aren't stories: the front page and the other views of it. */
export const VIEW_PATHS = ['/', '/terminal']

export const isRoute = (site: Site, pathname: string) => VIEW_PATHS.includes(normalizePath(pathname)) || findItem(site, pathname) !== undefined

export const deskName = (site: Site, item: Item) => item.desk ?? site.config.sectionNames[item.section]
