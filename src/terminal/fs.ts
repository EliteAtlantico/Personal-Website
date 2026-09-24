// The terminal's filesystem: the site's content laid out as files and folders.
//
//   ~/about.md  ~/now.md  ~/contact.txt  ~/resume.pdf
//   ~/<section>/<name>.md    one per story, e.g. ~/projects/butler-bot.md
//
// Folders are named after sections, so a file's path mirrors its page's URL
// (~/projects/butler-bot.md is /projects/butler-bot). Pure data and path logic.
import type { Item, Site } from '../content/types'

/** Who the visitor is logged in as, and the machine's name: guest@chaghouri. */
export const USER = 'guest'
export const HOST = 'chaghouri'

/** "Thu 24 Sep", as the status bar shows the date. */
export const barDate = (d: Date, timeZone?: string) => {
  const part = (options: Intl.DateTimeFormatOptions) => d.toLocaleDateString('en-US', { ...options, timeZone })
  return `${part({ weekday: 'short' })} ${part({ day: 'numeric' })} ${part({ month: 'short' })}`
}

export type Node = Dir | File

export interface Dir {
  kind: 'dir'
  name: string
  children: Node[]
}

export type File = { kind: 'file'; name: string } & (
  | { type: 'item'; item: Item }
  | { type: 'bio' }
  | { type: 'contact' }
  | { type: 'pdf'; href: string }
)

/** A story's file name: its slug, minus a prefix its folder already says ("hobby-guitar" is hobbies/guitar.md). */
export const fileName = (item: Item) => `${item.slug.replace(/^hobby-/, '')}.md`

export function buildFs(site: Site): Dir {
  const root: Dir = { kind: 'dir', name: '~', children: [] }
  const sections = new Map<string, Dir>()
  for (const item of site.items) {
    if (item.section === 'now') {
      root.children.push({ kind: 'file', name: 'now.md', type: 'item', item })
      continue
    }
    let dir = sections.get(item.section)
    if (!dir) {
      dir = { kind: 'dir', name: item.section, children: [] }
      sections.set(item.section, dir)
      root.children.push(dir)
    }
    dir.children.push({ kind: 'file', name: fileName(item), type: 'item', item })
  }
  if (site.bio) root.children.push({ kind: 'file', name: 'about.md', type: 'bio' })
  root.children.push({ kind: 'file', name: 'contact.txt', type: 'contact' })
  const resume = site.config.links.find((link) => link.url.endsWith('.pdf'))
  if (resume) root.children.push({ kind: 'file', name: 'resume.pdf', type: 'pdf', href: resume.url })
  sort(root)
  return root
}

function sort(dir: Dir) {
  dir.children.sort((a, b) => a.name.localeCompare(b.name))
  for (const child of dir.children) if (child.kind === 'dir') sort(child)
}

/** "~", or "~/projects" for the path ["projects"]. */
export const display = (path: string[]) => ['~', ...path].join('/')

/** A path from the prompt's folder to this one: relative when it's inside it, from ~ otherwise. */
export function relative(cwd: string[], path: string[]) {
  const inside = cwd.every((name, i) => path[i] === name)
  return inside && path.length > cwd.length ? path.slice(cwd.length).join('/') : display(path)
}

/**
 * Follows a path typed at the prompt: relative to the current folder, or from
 * "~" ("/" means the same). ".." goes up; a story's ".md" may be left off.
 */
export function resolve(root: Dir, cwd: string[], input: string): { node: Node; path: string[] } | null {
  const absolute = input.startsWith('~') || input.startsWith('/')
  const path = absolute ? [] : [...cwd]
  for (const part of input.replace(/^~/, '').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') path.pop()
    else path.push(part)
  }
  let node: Node = root
  const names: string[] = []
  for (const part of path) {
    if (node.kind !== 'dir') return null
    const next: Node | undefined = node.children.find((child) => child.name === part) ?? node.children.find((child) => child.name === `${part}.md`)
    if (!next) return null
    node = next
    names.push(next.name)
  }
  return { node, path: names }
}

/** Every file, with its path, depth first. */
export function files(dir: Dir, path: string[] = []): Array<{ file: File; path: string[] }> {
  return dir.children.flatMap((child) =>
    child.kind === 'dir' ? files(child, [...path, child.name]) : [{ file: child, path: [...path, child.name] }],
  )
}

/** A file found by name or slug anywhere ("butler-bot", "guitar.md", "hobby-guitar"). */
export function find(root: Dir, query: string) {
  const q = query.toLowerCase().replace(/\.md$/, '')
  return files(root).find(({ file }) => file.name.replace(/\.md$/, '') === q || (file.type === 'item' && file.item.slug === q))
}

/** Tab completion for a path being typed: the full candidates, folders ending in "/". */
export function completePath(root: Dir, cwd: string[], partial: string, dirsOnly = false) {
  const cut = partial.lastIndexOf('/') + 1
  const base = partial.slice(0, cut)
  const stem = partial.slice(cut)
  const dir = base ? resolve(root, cwd, base)?.node : resolve(root, cwd, '.')?.node
  if (!dir || dir.kind !== 'dir') return []
  return dir.children
    .filter((child) => child.name.startsWith(stem) && (!dirsOnly || child.kind === 'dir'))
    .map((child) => base + child.name + (child.kind === 'dir' ? '/' : ''))
}
