// The terminal's front page: the paper's layout redrawn as panes. The lead
// story on top with Now and About beside it, then one pane per desk, every
// story a row. In the shell a row opens the story in the terminal's reader;
// on the static /terminal page (no JavaScript) it links to the story's page.
import type { Item, Site } from '../content/types'
import { globeSummary } from '../render/globe'
import { formatShortDate } from '../render/html'
import { deskName, itemPath } from '../render/paths'
import { fileName } from './fs'
import { line, seg, type Line, type Pane, type Row, type Segment } from './output'

/** A story's file in the terminal: ~/projects/butler-bot.md (the Now item is ~/now.md). */
export const storyPath = (item: Item) => (item.section === 'now' ? '~/now.md' : `~/${item.section}/${fileName(item)}`)

/** "Nov 2025 – Present" is "Nov 2025" in a row; the story itself has the rest. */
const since = (dates?: string) => dates?.split(' – ')[0]

export function dashboard(site: Site, { live }: { live: boolean }): Line[] {
  const bySlug = new Map(site.items.map((item) => [item.slug, item]))
  const items = (slugs: string[]) => slugs.map((slug) => bySlug.get(slug)).filter((item): item is Item => !!item)
  const go = (item: Item): Pick<Row, 'run' | 'href'> => (live ? { run: `open ${storyPath(item)}` } : { href: itemPath(item) })
  const row = (item: Item): Row => ({ label: item.title, detail: since(item.dates), ...go(item) })
  const link = (text: string, run: string, href: string): Segment => ({ text, style: 'accent', ...(live ? { run } : { href }) })
  const email = site.config.links.find((l) => l.url.startsWith('mailto:'))?.url ?? '/'
  const resume = site.config.links.find((l) => l.url.endsWith('.pdf'))?.url ?? '/'

  const panes: Pane[] = []
  const lead = bySlug.get(site.config.lead)
  if (lead) {
    const meta = [lead.org, lead.dates, lead.status?.replaceAll('-', ' ')].filter(Boolean).join(' · ')
    panes.push({
      title: `lead · ${deskName(site, lead).toLowerCase()}`,
      note: lead.publication?.venue,
      area: 'lead',
      lines: [line(seg(lead.headline ?? lead.title, 'heading')), { ...line(lead.blurb), clamp: 4 }, ...(meta ? [line(seg(meta, 'dim'))] : [])],
      links: [link('read the story', `open ${storyPath(lead)}`, itemPath(lead))],
      rain: lead.slug,
    })
  }
  const now = site.items.find((item) => item.section === 'now')
  if (now) {
    panes.push({
      title: 'now',
      note: now.updated ? `updated ${formatShortDate(now.updated).replace(/, \d{4}$/, '')}` : undefined,
      area: 'now',
      lines: [{ ...line(now.blurb), clamp: 4 }],
      links: [link('read it all', `open ${storyPath(now)}`, itemPath(now))],
    })
  }
  panes.push({
    title: 'about',
    area: 'about',
    lines: [line(seg(site.config.author, 'strong')), line(site.config.tagline), line(seg(site.config.edition, 'dim'))],
    links: [
      link('about.md', 'open ~/about.md', '/'),
      link('résumé', 'resume', resume),
      link('contact', 'contact', email),
      ...(live ? [link('neofetch', 'neofetch', '/')] : []),
    ],
  })
  // Where it all happened: a globe fills the pane, and `globe` opens it full screen.
  panes.push({
    title: 'map',
    note: `${site.items.length} stories`,
    area: 'map',
    lines: [line(globeSummary(site))],
    links: live ? [link('full screen', 'globe', '/')] : [],
    globe: true,
  })
  for (const desk of site.config.desks) {
    const stories = items(desk.items)
    if (stories.length) panes.push({ title: desk.name.toLowerCase(), rows: stories.map(row) })
  }
  // The paper's right-hand rail (minus Now, which has its own pane): the opinion piece and the talk.
  const rail = items(site.config.rail).filter((item) => item.section !== 'now')
  if (rail.length) panes.push({ title: [...new Set(rail.map((item) => deskName(site, item).toLowerCase()))].join(' · '), rows: rail.map(row) })

  return [{ segments: [], panes }]
}
