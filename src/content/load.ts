// Reads content/ from disk. Runs at build time only (Vite plugin + prerender
// script), never in the browser, so Markdown is rendered once, up front.
import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import hyphen from 'hyphen/en-us/index.js'
import { imageSize } from 'image-size'
import { Marked, type Token } from 'marked'
import sharp from 'sharp'
import { parse as parseYaml } from 'yaml'
import { findSkyline } from '../layout/skyline'
import {
  SECTIONS,
  type Audience,
  type Bio,
  type Cover,
  type Item,
  type Link,
  type Media,
  type Publication,
  type Section,
  type Site,
  type SiteConfig,
} from './types'

export const CONTENT_DIR = path.resolve(process.cwd(), 'content')
export const MEDIA_DIR = path.join(CONTENT_DIR, 'media')
const ITEMS_DIR = path.join(CONTENT_DIR, 'items')
const TODO = /\bTODO\b/

/** Widths generated for every photo in production (see scripts/media.ts). */
export const MEDIA_WIDTHS = [480, 960, 1600]
export const IMAGE_FILE = /\.(jpe?g|png|webp|avif)$/i

interface LoadOptions {
  includeDrafts: boolean
  /** Point photos at the resized .webp copies the production build generates. */
  optimizeMedia?: boolean
}

export async function loadSite({ includeDrafts, optimizeMedia = false }: LoadOptions): Promise<Site> {
  const config = JSON.parse(await readFile(path.join(CONTENT_DIR, 'site.json'), 'utf8')) as SiteConfig
  const files = (await readdir(ITEMS_DIR)).filter((f) => f.endsWith('.md')).sort()
  const items = await Promise.all(
    files.map(async (file) => parseItem(file.slice(0, -3), await readFile(path.join(ITEMS_DIR, file), 'utf8'), optimizeMedia)),
  )
  // Only the lead story's opening is set on the front page; don't ship the rest to the browser.
  for (const item of items) if (item.slug !== config.lead) item.lede = []
  if (config.banner?.mode === 'silhouette') config.banner.skyline = await skylineOf(path.join(MEDIA_DIR, 'site', config.banner.src), config.banner.band ?? [0, 1])
  const site: Site = {
    config,
    items: items.filter((item) => includeDrafts || !item.draft),
    bio: await loadBio(),
    banner: await cover('site', config.banner, optimizeMedia, 'content/site.json: banner'),
    builtAt: new Date().toISOString(),
  }
  if (!includeDrafts) assertPublishable(site)
  return site
}

/** Worked out once per photo (the dev server loads the site for every page it serves). */
const skylines = new Map<string, { changed: number; skyline: string }>()

/**
 * The banner's rooftops (layout/portrait.ts's silhouette mode), found here, in
 * the photo scaled to the width the browser used to sample it at, so no
 * visitor has to download and scan the photo: `<width>x<height>:` then each
 * column's rooftop row as the change from the column before (small numbers,
 * which compress to almost nothing).
 */
async function skylineOf(file: string, band: [number, number]): Promise<string | undefined> {
  if (!existsSync(file)) return undefined
  const changed = (await stat(file)).mtimeMs
  const known = skylines.get(file)
  if (known?.changed === changed) return known.skyline
  const { data, info } = await sharp(file).rotate().resize({ width: 1200, withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  const rows = findSkyline((x, y) => {
    const i = (Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * channels
    return [data[i]!, data[i + 1]!, data[i + 2]!]
  }, width, height, band)
  const skyline = `${width}x${height}:${[...rows].map((row, x) => (x ? row - rows[x - 1]! : row)).join(',')}`
  skylines.set(file, { changed, skyline })
  return skyline
}

/** Production builds refuse to ship a leftover TODO. Finish the item or mark it `draft: true`. */
function assertPublishable(site: Site) {
  for (const item of site.items) {
    if (TODO.test(JSON.stringify(item))) {
      throw new Error(`content/items/${item.slug}.md still contains a TODO. Finish it or mark it draft: true.`)
    }
  }
}

async function loadBio(): Promise<Bio | undefined> {
  const file = path.join(CONTENT_DIR, 'bio.md')
  if (!existsSync(file)) return undefined
  const { fm, body } = splitFrontmatter('bio', await readFile(file, 'utf8'))
  return { title: text(fm.title) ?? 'About the editor', text: hyphenate(plain(cleanBody(body))) }
}

function splitFrontmatter(name: string, source: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(source)
  if (!match) throw new Error(`content/${name}.md: missing --- frontmatter ---`)
  return { fm: (parseYaml(match[1] ?? '') ?? {}) as Record<string, unknown>, body: match[2] ?? '' }
}

async function parseItem(slug: string, source: string, optimizeMedia: boolean): Promise<Item> {
  const { fm, body: rawBody } = splitFrontmatter(`items/${slug}`, source)

  const section = fm.section as Section
  if (!SECTIONS.includes(section)) {
    throw new Error(`content/items/${slug}.md: unknown section "${String(fm.section)}" (expected one of ${SECTIONS.join(', ')})`)
  }

  const body = cleanBody(rawBody)
  const blurb = text(fm.blurb) ?? ''
  const excerpt = !blurb && fm.blurb_mode === 'excerpt'
  // Relative image paths in the body ("diagram.png") point at content/media/<slug>/.
  const marked = new Marked({
    gfm: true,
    walkTokens(token) {
      if (token.type === 'image' && !/^(https?:|\/)/.test(token.href)) token.href = `/media/${slug}/${token.href}`
    },
  })

  return {
    slug,
    section,
    desk: text(fm.desk),
    title: text(fm.title) ?? slug,
    headline: text(fm.headline),
    org: text(fm.org),
    role: text(fm.role),
    dates: text(fm.dates),
    status: text(fm.status),
    place: text(fm.place),
    remote: fm.remote === true,
    team: strings(fm.team),
    tags: strings(fm.tags),
    audience: audience(fm.audience),
    blurb: blurb || (excerpt ? excerptOf(body) : ''),
    excerpt,
    span: Math.min(3, Math.max(1, Math.round(typeof fm.span === 'number' ? fm.span : 1))),
    cover: await cover(slug, fm.cover, optimizeMedia),
    stack: strings(fm.stack),
    outcomes: strings(fm.outcomes),
    datasets: strings(fm.datasets),
    links: links(fm.links),
    media: media(slug, fm.media),
    publication: publication(fm.publication),
    paper: text(fm.paper),
    updated: text(fm.updated),
    lede: lede(marked.lexer(body)),
    bodyHtml: body ? (marked.parse(body) as string) : '',
    draft: fm.draft === true,
  }
}

/** Editor notes (HTML comments) and "TODO:" placeholder lines never reach the page. */
function cleanBody(markdown: string) {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^TODO\b.*$/gm, '')
    .trim()
}

/** Markdown → plain text: drops headings, emphasis, code ticks and link targets. */
function plain(markdown: string) {
  return markdown
    .replace(/^#+\s.*$/gm, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** First ~45 words of the body, for tiles whose "blurb" is the opening of the article itself. */
function excerptOf(markdown: string) {
  const words = plain(markdown).split(' ')
  return words.length <= 45 ? words.join(' ') : `${words.slice(0, 45).join(' ')}…`
}

/**
 * The body as plain paragraphs (list items become paragraphs, headings are
 * dropped), up to ~400 words. The front page sets as much of it as fits,
 * then says "Continued inside", like a newspaper.
 */
function lede(tokens: Token[], budget = 400) {
  const blocks = tokens.flatMap((token): string[] => {
    if (token.type === 'paragraph') return [token.text]
    if (token.type === 'list') return (token.items as Array<{ text: string }>).map((item) => item.text)
    return []
  })
  const paragraphs: string[] = []
  let words = 0
  for (const block of blocks) {
    const paragraph = plain(block)
    const count = paragraph.split(' ').length
    if (paragraphs.length && words + count > budget) break
    paragraphs.push(hyphenate(paragraph))
    words += count
  }
  return paragraphs
}

/**
 * Inserts invisible soft hyphens (U+00AD) at the break points an English
 * dictionary allows. Done here, at build time, so visitors download no
 * hyphenation data; pretext and browsers only show a hyphen where a line
 * actually breaks. Used for the justified text (front-page jump, bio).
 */
function hyphenate(text: string) {
  // Lowercase words only: names (MannLab, Mersivity, Toronto) never get split.
  return text.replace(/\b[a-z]{7,}\b/g, (word) => hyphen.hyphenateSync(word, { minWordLength: 7 }))
}

/** A photo (or video + poster) in content/media/<folder>/, with its dimensions read from the file. */
async function cover(folder: string, value: unknown, optimize: boolean, where = `content/items/${folder}.md: cover`): Promise<Cover | undefined> {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  const slug = folder
  const alt = text(v.alt)
  const image = text(v.src)
  const video = text(v.video)
  const still = image ?? text(v.poster)
  if (!alt) throw new Error(`${where} needs alt text describing the ${video ? 'video' : 'image'}`)
  if (!still) throw new Error(`${where} needs "src" (a photo) or "video" plus a "poster" still`)
  const file = path.join(MEDIA_DIR, slug, still)
  if (!existsSync(file)) throw new Error(`${where} file not found: content/media/${slug}/${still}`)
  const size = imageSize(await readFile(file))
  // Phone photos are often stored sideways with an EXIF "rotate me" flag (orientations 5–8).
  const sideways = (size.orientation ?? 1) >= 5
  const width = sideways ? size.height : size.width
  const height = sideways ? size.width : size.height
  if (!width || !height) throw new Error(`${where}: couldn't read the dimensions of ${still}`)

  const url = (name: string) => `/media/${slug}/${name}`
  const variants = optimize && IMAGE_FILE.test(still) ? mediaVariants(still, width).map((v) => ({ ...v, url: url(v.name) })) : []
  const best = variants.filter((v) => v.width <= 960).at(-1) ?? variants[0]
  const stillUrl = best?.url ?? url(still)

  if (video) {
    if (!existsSync(path.join(MEDIA_DIR, slug, video))) throw new Error(`${where} video not found: content/media/${slug}/${video}`)
    return { kind: 'video', src: url(video), poster: variants.at(-1)?.url ?? url(still), width, height, alt }
  }
  return {
    kind: 'image',
    src: stillUrl,
    srcset: variants.length ? variants.map((v) => `${v.url} ${v.width}w`).join(', ') : undefined,
    width,
    height,
    alt,
  }
}

/** The .webp copies generated for a photo: every standard width below its own, plus its own (capped). */
export function mediaVariants(file: string, width: number) {
  const base = file.replace(/\.[^.]+$/, '')
  const widths = [...new Set([...MEDIA_WIDTHS.filter((w) => w < width), Math.min(width, MEDIA_WIDTHS.at(-1)!)])].sort((a, b) => a - b)
  return widths.map((w) => ({ width: w, name: `${base}-${w}.webp` }))
}

function text(value: unknown): string | undefined {
  if (typeof value === 'number') return String(value)
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(text).filter((v): v is string => v !== undefined)
}

function audience(value: unknown): Audience {
  const v = (value ?? {}) as Record<string, unknown>
  const n = (x: unknown) => (typeof x === 'number' ? x : 0)
  return { recruiter: n(v.recruiter), research: n(v.research), dev: n(v.dev) }
}

function links(value: unknown): Link[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const label = text((entry as Record<string, unknown>)?.label)
    const url = text((entry as Record<string, unknown>)?.url)
    return label && url ? [{ label, url }] : []
  })
}

function media(slug: string, value: unknown): Media[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): Media[] => {
    const m = (entry ?? {}) as Record<string, unknown>
    const id = text(m.id)
    const src = text(m.src)
    const alt = text(m.alt)
    if (m.type === 'youtube' && id) return [{ type: 'youtube', id, title: text(m.title) }]
    if (m.type === 'image' && src && alt) {
      return [{ type: 'image', src: /^(https?:|\/)/.test(src) ? src : `/media/${slug}/${src}`, alt, caption: text(m.caption) }]
    }
    return []
  })
}

function publication(value: unknown): Publication | undefined {
  const p = (value ?? {}) as Record<string, unknown>
  const venue = text(p.venue)
  const title = text(p.title)
  return venue && title ? { venue, title, position: text(p.position), status: text(p.status) } : undefined
}
