// Makes the site's font files. Each font the site uses (fontsource's builds of
// Fraunces, Newsreader and IBM Plex Mono) has its Latin set split in two: the
// characters the site actually shows (its core: preloaded, and all a page
// normally needs), and the rest (downloaded only by a page that has one of
// them, say a visitor's city with an umlaut). Fonts are the biggest thing a
// page waits for before it shows itself, and the cores are about a third
// smaller than the whole sets. Nothing is lost: every character the whole set
// had is still there, and the other scripts' files are fontsource's own.
//
// Run it again when the site starts using a character it didn't (or the fonts
// change): `bun run fonts`. It writes src/fonts/*.woff2 and
// src/styles/fonts.css; don't edit those by hand. It needs Python's fontTools
// (pip install fonttools); Brotli, for WOFF2, it borrows from Bun.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { python } from './fonttools'

/** The fontsource stylesheets the site used to import (src/main.ts). */
const SHEETS = [
  '@fontsource-variable/fraunces/wght.css',
  '@fontsource-variable/newsreader/wght.css',
  '@fontsource-variable/newsreader/wght-italic.css',
  '@fontsource/ibm-plex-mono/400.css',
  '@fontsource/ibm-plex-mono/500.css',
]
const OUT = path.resolve('src/fonts')
const CSS = path.resolve('src/styles/fonts.css')
const require = createRequire(import.meta.url)

// --- What the site shows: printable ASCII (anyone can type it into the terminal), and every other
// character in the content, the code's own text (written out or \u-escaped) and the page template;
// and, once there's a build, its pages' text too (what Markdown and the templates made of it). ---
const wanted = new Set<number>()
for (let c = 0x20; c <= 0x7e; c++) wanted.add(c)
// Drawn by the browser, not written anywhere: a list's bullet.
wanted.add(0x2022)
const add = (text: string) => {
  for (const ch of text) wanted.add(ch.codePointAt(0)!)
}
const files = (dir: string): string[] =>
  existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)])) : []
for (const file of [...files('content'), ...files('src'), 'index.html']) {
  if (!/\.(md|json|ts|html|css)$/.test(file) || file.startsWith(OUT)) continue
  const text = readFileSync(file, 'utf8')
  add(text)
  add(text.replace(/\\u\{?([0-9a-fA-F]{4,6})\}?/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16))))
  // CSS escapes, as in content: '\2014'.
  if (file.endsWith('.css')) add(text.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16))))
}
const NAMED: Record<string, string> = { nbsp: '\u00a0', middot: '\u00b7', times: '\u00d7', ndash: '\u2013', mdash: '\u2014', hellip: '\u2026', copy: '\u00a9', deg: '\u00b0', rarr: '\u2192', larr: '\u2190' }
for (const file of files('dist').filter((f) => f.endsWith('.html'))) {
  add(
    readFileSync(file, 'utf8')
      .replace(/<(script|style)[\s\S]*?<\/\1>|<[^>]*>/g, ' ')
      .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
      .replace(/&([a-z]+);/g, (entity, name: string) => NAMED[name] ?? entity),
  )
}

// CSS can show text in capitals (text-transform: uppercase makes "résumé" RÉSUMÉ), or small ones.
for (const c of [...wanted]) {
  const ch = String.fromCodePoint(c)
  for (const cased of [ch.toUpperCase(), ch.toLowerCase()]) if ([...cased].length === 1) wanted.add(cased.codePointAt(0)!)
}

// --- The faces ---
interface Face {
  comment: string
  family: string
  style: string
  weight: string
  src: string
  format: string
  range: string
}

function faces(sheet: string): { dir: string; faces: Face[] } {
  const file = require.resolve(sheet)
  const css = readFileSync(file, 'utf8')
  const out: Face[] = []
  for (const [, comment, body] of css.matchAll(/\/\*\s*(.+?)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)) {
    const get = (name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(body!)?.[1]?.trim() ?? ''
    const [, src = '', format = ''] = /url\(([^)]+)\)\s*format\(([^)]+)\)/.exec(get('src')) ?? []
    out.push({ comment: comment!, family: get('font-family'), style: get('font-style'), weight: get('font-weight'), src, format, range: get('unicode-range') })
  }
  return { dir: path.dirname(file), faces: out }
}

/** "U+0000-00FF,U+0131" as code points. */
function codepoints(range: string) {
  const set = new Set<number>()
  for (const part of range.split(',')) {
    const [a, b] = part.trim().replace(/^U\+/i, '').split('-')
    for (let c = parseInt(a!, 16); c <= parseInt(b ?? a!, 16); c++) set.add(c)
  }
  return set
}

/** Code points as a unicode-range. */
function range(set: Set<number>) {
  const sorted = [...set].sort((a, b) => a - b)
  const parts: string[] = []
  for (let i = 0; i < sorted.length; ) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++
    const hex = (c: number) => c.toString(16).toUpperCase().padStart(4, '0')
    parts.push(i === j ? `U+${hex(sorted[i]!)}` : `U+${hex(sorted[i]!)}-${hex(sorted[j]!)}`)
    i = j + 1
  }
  return parts.join(',')
}

function subset(input: string, unicodes: Set<number>, output: string) {
  python(['-m', 'fontTools.subset', input, `--unicodes=${range(unicodes)}`, '--flavor=woff2', `--output-file=${output}`, '--layout-features=*', '--name-IDs=*', '--notdef-outline'], `subset ${input}`)
}

// --- Out ---
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const rules: string[] = []
const kb = (file: string) => `${(readFileSync(file).length / 1024).toFixed(1)} KB`
for (const sheet of SHEETS) {
  const { dir, faces: list } = faces(sheet)
  for (const face of list) {
    const file = path.resolve(dir, face.src)
    const rule = (url: string, unicodes: string, comment: string) =>
      `/* ${comment} */\n@font-face {\n  font-family: ${face.family};\n  font-style: ${face.style};\n  font-display: swap;\n  font-weight: ${face.weight};\n  src: url(${url}) format(${face.format});\n  unicode-range: ${unicodes};\n}`
    if (!/-latin-(?!ext)/.test(face.comment)) {
      // Other scripts' sets stay fontsource's own files.
      rules.push(rule(path.relative(path.dirname(CSS), file).split(path.sep).join('/'), face.range, face.comment))
      continue
    }
    const latin = codepoints(face.range)
    const core = new Set([...latin].filter((c) => wanted.has(c)))
    const rest = new Set([...latin].filter((c) => !wanted.has(c)))
    const name = path.basename(file, '.woff2')
    for (const [part, set] of [
      ['core', core],
      ['rest', rest],
    ] as const) {
      const out = path.join(OUT, `${name}-${part}.woff2`)
      subset(file, set, out)
      rules.push(rule(`../fonts/${name}-${part}.woff2`, range(set), `${face.comment}: ${part === 'core' ? 'what the site shows' : 'the rest of the set'}`))
    }
    console.log(`${name}: ${kb(file)} → ${kb(path.join(OUT, `${name}-core.woff2`))} core + ${kb(path.join(OUT, `${name}-rest.woff2`))} rest`)
  }
}
writeFileSync(
  CSS,
  `/* The site's fonts: made by scripts/fonts.ts (bun run fonts) from fontsource's. Don't edit by hand.
   Each font's Latin set is split into what the site shows (preloaded: scripts/prerender.ts) and the rest. */\n\n${rules.join('\n\n')}\n`,
)
if (!existsSync(CSS)) throw new Error('fonts.css was not written')
console.log(`wrote ${path.relative('.', CSS)} and ${readdirSync(OUT).length} fonts in ${path.relative('.', OUT)}`)
