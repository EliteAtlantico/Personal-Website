// The move between a front-page tile and its article header (and back).
// pretext lays out the headline and dek on both screens, in the tile's column
// and in the article's, down to where every word sits. Then each word simply
// flies from its spot on the old screen to its spot on the new one: it's drawn
// once, at its final size, and only moves and scales, so nothing re-wraps along
// the way. Words set off a few milliseconds apart so they float rather than
// march, and the whole flight is over in under half a second.
//
// What flies is pretext's segments: words, split where a line may break
// ("mixed-" + "reality", "(2024–" + "25),"). The pieces of a word fly together,
// but can land on different lines when one screen breaks the word and the other
// doesn't.
import { layoutWithLines, type PreparedTextWithSegments } from '@chenglou/pretext'
import { FAMILY, applyFont, canvasFont, type FontSpec } from './fonts'
import { prep } from './text'

/** A piece of text as pretext placed it: the top-left of its line box, in viewport px. */
interface Piece {
  text: string
  x: number
  y: number
  /** Which word it belongs to (pieces of one word share a number). */
  word: number
}

/** A headline or dek, laid out by pretext. */
interface Block {
  el: HTMLElement
  font: FontSpec
  lineHeight: number
  color: string
  pieces: Piece[]
}

export interface MorphSnap {
  headline: Block
  dek?: Block
  kicker?: { el: HTMLElement; rect: DOMRect }
}

/** Reads the headline, dek and kicker of a tile or story header. Null if there's nothing to morph. */
export function captureMorph(container: Element | null): MorphSnap | null {
  if (!container) return null
  const headline = container.querySelector<HTMLElement>('.tile__headline, .story__headline')
  if (!headline || !headline.getClientRects().length) return null
  const dek = container.querySelector<HTMLElement>('.tile__dek, .story__dek')
  const kicker = container.querySelector<HTMLElement>('.kicker')
  return {
    headline: block(headline, FAMILY.display),
    dek: dek?.getClientRects().length ? block(dek, FAMILY.text) : undefined,
    kicker: kicker?.getClientRects().length ? { el: kicker, rect: kicker.getBoundingClientRect() } : undefined,
  }
}

function block(el: HTMLElement, family: string): Block {
  const style = getComputedStyle(el)
  const size = parseFloat(style.fontSize)
  const font: FontSpec = {
    family,
    weight: Number(style.fontWeight) || 400,
    size,
    italic: style.fontStyle === 'italic',
    tracking: style.letterSpacing === 'normal' ? 0 : parseFloat(style.letterSpacing) / size,
  }
  const lineHeight = parseFloat(style.lineHeight) || size * 1.3
  const box = el.getBoundingClientRect()
  const left = box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft)
  const top = box.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop)
  const width = box.width - (left - box.left) - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight)
  const text = textOf(el)
  const words = wordNumbers(text, font)

  // A copyfitted headline already holds pretext's lines, one per <br>. Anything
  // else (a dek) is laid out by pretext at its column's width, as the browser wraps it.
  let lines = el.dataset.fitWidth
    ? brokenLines(el).map((line) => placeLine(line, font))
    : layoutWithLines(kerned(text, font), width, lineHeight).lines.map((line) => placeLine(line.text.trimEnd(), font))
  if (!el.dataset.fitWidth) {
    // pretext's line breaks match the browser's except when a line comes within a
    // fraction of a pixel of the column's width. Check where each line starts on the
    // page (one read per line) and, if they differ, follow the page's line breaks.
    const page = pageRanges(el, words)
    const height = box.height - (top - box.top) - parseFloat(style.borderBottomWidth) - parseFloat(style.paddingBottom)
    if (page && !sameLines(page, lines, { left, top, lineHeight, height })) lines = linesOf(page, words).map((line) => placeLine(line, font))
  }
  const pieces = lines.flatMap((line, row) => line.map((piece) => ({ text: piece.text, x: left + piece.x, y: top + row * lineHeight })))
  return {
    el,
    font,
    lineHeight,
    color: style.color,
    pieces: pieces.map((piece, i) => ({ ...piece, word: words[i]?.word ?? i })),
  }
}

/** The lines of a copyfitted headline (text between <br>s), skipping decoration such as the swarm. */
function brokenLines(el: HTMLElement) {
  const lines = ['']
  for (const node of el.childNodes) {
    if (node.nodeName === 'BR') lines.push('')
    else if (node.nodeType === Node.TEXT_NODE) lines[lines.length - 1] += node.textContent ?? ''
  }
  return lines.map((line) => line.trim())
}

const textOf = (el: HTMLElement) => (el.dataset.text ?? el.textContent ?? '').replace(/\s+/g, ' ').trim()
const isSpace = (kind: string | undefined) => kind === 'space' || kind === 'preserved-space' || kind === 'tab' || kind === 'hard-break'
const isInk = (kind: string | undefined) => !isSpace(kind) && kind !== 'soft-hyphen' && kind !== 'zero-width-break'

/** pretext's pieces of some text, in order, each numbered by the word it belongs to. */
function wordNumbers(text: string, font: FontSpec) {
  const prepared = prep(text, font)
  const pieces: Array<{ text: string; word: number }> = []
  let word = 0
  let spaced = false
  prepared.segments.forEach((segment, i) => {
    const kind = prepared.kinds[i]
    if (isSpace(kind)) spaced = pieces.length > 0
    else if (isInk(kind)) {
      if (spaced) word++
      spaced = false
      pieces.push({ text: segment, word })
    }
  })
  return pieces
}

/**
 * Where each piece of one line starts, from pretext's measured segment widths.
 * pretext adds letter-spacing before every segment after the first, as CSS does.
 * It measures each segment on its own, though, so it can't see the kerning the
 * page applies across segment boundaries (e.g. "f" then a space); add that back.
 */
function placeLine(line: string, font: FontSpec) {
  const prepared = prep(line, font)
  const pieces: Array<{ text: string; x: number }> = []
  let x = 0
  prepared.segments.forEach((segment, i) => {
    if (i > 0) {
      x += kerning(font, prepared.segments[i - 1]!, segment)
      if (prepared.letterSpacing && prepared.spacingGraphemeCounts[i]) x += prepared.letterSpacing
    }
    if (isInk(prepared.kinds[i])) pieces.push({ text: segment, x })
    x += prepared.widths[i]!
  })
  return pieces
}

/** Ranges over the page's own text for each piece, in order (their positions are only read when asked for). */
function pageRanges(el: HTMLElement, pieces: Array<{ text: string }>) {
  const ranges: Range[] = []
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  let offset = 0
  for (const piece of pieces) {
    // Skip the spaces (and soft hyphens) between pieces, moving on to the next text node if need be.
    for (;;) {
      if (!node) return null
      const text = node.textContent ?? ''
      while (offset < text.length && /[\s­]/.test(text[offset]!)) offset++
      if (offset < text.length) break
      node = walker.nextNode()
      offset = 0
    }
    if (!(node.textContent ?? '').startsWith(piece.text, offset)) return null
    const range = document.createRange()
    range.setStart(node, offset)
    range.setEnd(node, offset + piece.text.length)
    ranges.push(range)
    offset += piece.text.length
  }
  return ranges
}

/** True if the page starts each of these lines where pretext does: at the left edge, on the same row. */
function sameLines(page: Range[], lines: unknown[][], at: { left: number; top: number; lineHeight: number; height: number }) {
  if (lines.reduce((sum, line) => sum + line.length, 0) !== page.length || Math.abs(at.height - lines.length * at.lineHeight) > at.lineHeight / 2) return false
  let first = 0
  return lines.every((line, row) => {
    const rect = page[first]!.getBoundingClientRect()
    first += line.length
    return Math.abs(rect.left - at.left) < 1 && Math.abs((rect.top + rect.bottom) / 2 - (at.top + (row + 0.5) * at.lineHeight)) < at.lineHeight / 2
  })
}

/** The page's own line breaks: its pieces grouped by the row they sit on, rejoined into lines. */
function linesOf(page: Range[], pieces: Array<{ word: number }>) {
  const rows: Array<{ mid: number; text: string; word: number }> = []
  page.forEach((range, i) => {
    const rect = range.getBoundingClientRect()
    const mid = (rect.top + rect.bottom) / 2
    const row = rows.at(-1)
    const word = pieces[i]!.word
    if (row && Math.abs(row.mid - mid) < rect.height / 2) {
      row.text += (word === row.word ? '' : ' ') + range.toString()
      row.word = word
    } else rows.push({ mid, text: range.toString(), word })
  })
  return rows.map((row) => row.text)
}

const kernedCache = new WeakMap<PreparedTextWithSegments, PreparedTextWithSegments>()

/**
 * pretext's preparation of some text, with the page's kerning across segment
 * boundaries folded into the segment widths (each kern counts with the segment
 * after it), so pretext breaks lines where the browser does. A copy: the
 * cached preparation other layouts share is left as it is.
 */
function kerned(text: string, font: FontSpec): PreparedTextWithSegments {
  const prepared = prep(text, font)
  let copy = kernedCache.get(prepared)
  if (!copy) {
    const widths = [...prepared.widths]
    const fit = [...prepared.lineEndFitAdvances]
    const paint = [...prepared.lineEndPaintAdvances]
    for (let i = 1; i < prepared.segments.length; i++) {
      const kern = kerning(font, prepared.segments[i - 1]!, prepared.segments[i]!)
      widths[i] = widths[i]! + kern
      // Spaces don't count at the end of a line (their line-end advances are 0); keep it that way.
      if (fit[i]) fit[i] = fit[i]! + kern
      if (paint[i]) paint[i] = paint[i]! + kern
    }
    copy = { ...prepared, widths, lineEndFitAdvances: fit, lineEndPaintAdvances: paint }
    kernedCache.set(prepared, copy)
  }
  return copy
}

let kernContext: CanvasRenderingContext2D | null = null
const kerns = new Map<string, number>()
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** The kerning between the last letter of one segment and the first of the next, as the page applies it. */
function kerning(font: FontSpec, before: string, after: string) {
  const a = [...graphemes.segment(before)].pop()?.segment ?? ''
  const b = graphemes.segment(after)[Symbol.iterator]().next().value?.segment ?? ''
  const css = canvasFont(font)
  const key = `${css}|${a}|${b}`
  let kern = kerns.get(key)
  if (kern === undefined) {
    kernContext ??= document.createElement('canvas').getContext('2d')
    if (!kernContext) return 0
    kernContext.fontKerning = 'normal'
    kernContext.font = css
    const width = (s: string) => kernContext!.measureText(s).width
    kern = width(a + b) - width(a) - width(b)
    kerns.set(key, kern)
  }
  return kern
}

/** How many pieces, from the start, both screens show (a tile may show only an excerpt, ending in "…"). */
function sharedPieces(a: Piece[], b: Piece[]) {
  const same = (x: string, y: string) => x.replace(/…$/, '') === y.replace(/…$/, '')
  let n = 0
  while (n < a.length && n < b.length && same(a[n]!.text, b[n]!.text)) n++
  return n
}

/** Milliseconds each word is in the air. */
const FLIGHT = 360
/** Between the first word setting off and the last. */
const SPREAD = 80
/** Quick off the mark, soft landing. */
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)'

export interface Morph {
  done: Promise<void>
  /** Jump to the end immediately (e.g. the visitor navigated again). */
  finish(): void
}

export function morph(from: MorphSnap, to: MorphSnap): Morph {
  // Headline to headline, dek to dek.
  const pairs = (
    [
      [from.headline, to.headline],
      [from.dek, to.dek],
    ] as const
  ).filter(([a, b]) => a || b)
  const kickers = from.kicker && to.kicker ? { a: from.kicker, b: to.kicker } : null
  const hidden = [...pairs.flatMap(([a, b]) => [a?.el, b?.el]), kickers?.a.el, kickers?.b.el].filter((el): el is HTMLElement => !!el)
  for (const el of hidden) el.style.visibility = 'hidden'

  const overlay = document.createElement('div')
  overlay.className = 'morph'
  overlay.setAttribute('aria-hidden', 'true')
  const animations: Animation[] = []

  const span = (text: string, look: Block) => {
    const el = document.createElement('span')
    el.className = 'morph__word'
    el.textContent = text
    applyFont(el, look.font, look.lineHeight)
    el.style.color = look.color
    overlay.append(el)
    return el
  }
  const at = (piece: Piece, scale = 1, dy = 0) => `translate(${piece.x.toFixed(2)}px, ${(piece.y + dy).toFixed(2)}px) scale(${scale.toFixed(4)})`

  // Each word sets off a moment after the one before it (all its pieces together).
  const shared = pairs.map(([a, b]) => sharedPieces(a?.pieces ?? [], b?.pieces ?? []))
  const flying = pairs.map(([, b], p) => new Set(b?.pieces.slice(0, shared[p]).map((piece) => piece.word)).size)
  const total = flying.reduce((sum, n) => sum + n, 0)
  let words = 0

  pairs.forEach(([a, b], p) => {
    const n = shared[p]!
    if (a && b) {
      // Each piece is drawn at its size on the new screen and starts scaled to its old size. The two
      // screens use different line heights, so shift it to keep its baseline exactly where it was.
      const scale = a.font.size / b.font.size
      const dy = (a.lineHeight - scale * b.lineHeight) / 2
      const delays = new Map<number, number>()
      for (let i = 0; i < n; i++) {
        const piece = b.pieces[i]!
        let delay = delays.get(piece.word)
        if (delay === undefined) {
          delay = (words++ / Math.max(1, total - 1)) * SPREAD + Math.random() * 16
          delays.set(piece.word, delay)
        }
        animations.push(
          span(piece.text, b).animate([{ transform: at(a.pieces[i]!, scale, dy) }, { transform: at(piece) }], {
            duration: FLIGHT,
            delay,
            easing: EASE,
            fill: 'both',
          }),
        )
      }
    }
    // Pieces only one screen has (the rest of an excerpt) fade in or out where they are.
    for (const piece of b?.pieces.slice(n) ?? []) {
      animations.push(
        span(piece.text, b!).animate([{ transform: at(piece), opacity: 0 }, { transform: at(piece), opacity: 1 }], {
          duration: 200,
          delay: FLIGHT / 2,
          easing: 'ease-out',
          fill: 'both',
        }),
      )
    }
    for (const piece of a?.pieces.slice(n) ?? []) {
      animations.push(
        span(piece.text, a!).animate([{ transform: at(piece), opacity: 1 }, { transform: at(piece), opacity: 0 }], {
          duration: 150,
          easing: 'ease-out',
          fill: 'both',
        }),
      )
    }
  })

  if (kickers) {
    const kicker = kickers.b.el.cloneNode(true) as HTMLElement
    kicker.classList.add('morph__kicker')
    kicker.style.visibility = 'visible'
    overlay.append(kicker)
    const [a, b] = [kickers.a.rect, kickers.b.rect]
    const move = (r: DOMRect, scale: number) => `translate(${r.left.toFixed(2)}px, ${r.top.toFixed(2)}px) scale(${scale.toFixed(4)})`
    animations.push(
      kicker.animate([{ transform: move(a, b.height ? a.height / b.height : 1) }, { transform: move(b, 1) }], {
        duration: FLIGHT,
        easing: EASE,
        fill: 'both',
      }),
    )
  }
  document.body.append(overlay)

  let resolve!: () => void
  const done = new Promise<void>((r) => (resolve = r))
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    overlay.remove()
    for (const el of hidden) el.style.visibility = ''
    // Words that are still flying stop, and every animation lets go of its word.
    for (const animation of animations) animation.cancel()
    resolve()
  }
  Promise.all(animations.map((a) => a.finished)).then(finish, finish)
  // Hidden tabs get no animation frames; never leave the page half-transitioned.
  const safety = setTimeout(finish, FLIGHT + SPREAD + 400)
  done.then(() => clearTimeout(safety))
  return { done, finish }
}
