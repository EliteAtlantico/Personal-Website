// On a phone, the stories trail the scroll. As the page moves, each piece holds
// back for a moment and then springs into place, so the text seems to pour
// after the scroll and catch up. What's coming onto the screen trails furthest
// (from below on the way down, from above on the way up), so the gaps between
// things only ever open and nothing runs into anything. Stories trail whole,
// carrying their rules and photos; pretext breaks every summary into its lines,
// and those trail inside their story, each a little further than the one above,
// so a paragraph stretches like a ribbon and settles. Only the panel showing
// moves, only while something is moving, and never for a visitor who'd rather
// things kept still.
import { layoutWithLines } from '@chenglou/pretext'
import { calm } from '../signals'
import type { App } from './app'
import type { FontSpec } from './fonts'
import { prep } from './text'

/** The furthest anything trails (px): it eases toward this, so a fast flick still shows the lower lines further behind. */
const MAX = 48

/** What trails: the blocks (a rule or a box moves with its block), then, inside a story, its lines. */
const PIECES = [
  '.rail',
  '.lead__secondary',
  '.jump',
  '.jump__more',
  '.pager__about',
  '.desk__name',
  '.desk__stories',
  '.tile',
  // The Now box's lines stay in its box.
  '.tile:not(.tile--now) :is(.kicker, .tile__headline, .drift-line, .tile__more, .tile__byline)',
].join(', ')

interface Mover {
  el: HTMLElement
  panel: HTMLElement
  /** The piece it sits inside, which carries it: it moves by the difference. */
  parent: Mover | undefined
  /** Where its top sits on the page at rest (px from the top of the document). */
  top: number
  /** How far behind it is (px, unbounded), its speed, and how far behind it shows (px, eased under MAX). */
  off: number
  v: number
  shown: number
}

export function drift(page: HTMLElement, signal: AbortSignal, app: App) {
  if (calm()) return
  let movers: Mover[] = []
  let dirty = true

  const collect = () => {
    for (const mover of movers) mover.el.style.translate = ''
    movers = []
    // Every summary's measure read first, then all of them broken into lines: one layout, not one each.
    const decks = [...app.pager.querySelectorAll<HTMLElement>('.tile:not(.tile--now) .tile__dek')].map((dek) => [dek, measure(dek)] as const)
    for (const [dek, measured] of decks) split(dek, measured)
    for (const panel of app.pager.querySelectorAll<HTMLElement>('.pager__panel')) {
      // In document order, so a piece's parent is always found (and moved) before it.
      const found = new Map<Element, Mover>()
      for (const el of panel.querySelectorAll<HTMLElement>(PIECES)) {
        let up = el.parentElement
        while (up && up !== panel && !found.has(up)) up = up.parentElement
        const mover: Mover = { el, panel, parent: up ? found.get(up) : undefined, top: 0, off: 0, v: 0, shown: 0 }
        found.set(el, mover)
        movers.push(mover)
      }
    }
    dirty = true
  }
  /** Where everything sits at rest (measured with its trail taken off). */
  const rest = () => {
    const y = window.scrollY
    for (const mover of movers) mover.top = mover.el.getBoundingClientRect().top + y - mover.shown
    dirty = false
  }

  let lastY = window.scrollY
  let lastT = 0
  let frame = 0
  const tick = (now: number) => {
    frame = 0
    const dt = Math.min(0.05, (now - (lastT || now)) / 1000) || 1 / 60
    lastT = now
    if (dirty) rest()
    const y = window.scrollY
    const moved = y - lastY
    lastY = y
    const panel = app.active()
    const height = window.innerHeight
    let busy = false
    for (const mover of movers) {
      // Every piece in the panel moves, on the screen or not, so the order holds as pieces come on.
      if (mover.panel !== panel) {
        if (mover.off || mover.v) {
          mover.off = mover.v = mover.shown = 0
          mover.el.style.translate = ''
        }
        continue
      }
      // Scrolled by `moved`: a piece holds back a share of it, more the nearer it is to the edge the
      // page is coming in from (the same share for everything at one height, so the order holds).
      const low = Math.max(0, Math.min(1, (mover.top - y) / height))
      const coming = moved >= 0 ? low : 1 - low
      mover.off = Math.max(-2.5 * MAX, Math.min(2.5 * MAX, mover.off + moved * (0.03 + 0.4 * coming)))
      // Then springs home.
      mover.v += (-120 * mover.off - 16 * mover.v) * dt
      mover.off += mover.v * dt
      if (Math.abs(mover.off) < 0.15 && Math.abs(mover.v) < 1.5) mover.off = mover.v = 0
      else busy = true
      mover.shown = MAX * Math.tanh(mover.off / MAX)
      const own = mover.shown - (mover.parent?.shown ?? 0)
      mover.el.style.translate = Math.abs(own) < 0.05 ? '' : `0 ${own.toFixed(2)}px`
    }
    if (busy || moved) frame = requestAnimationFrame(tick)
    else lastT = 0
  }
  const wake = () => {
    if (!frame) frame = requestAnimationFrame(tick)
  }

  collect()
  window.addEventListener('scroll', wake, { passive: true, signal })
  // A new panel: everything's re-measured (it was off to the side). A new width (a phone turned
  // sideways): the lines are broken again too.
  app.onChange(() => {
    dirty = true
    lastY = window.scrollY
  })
  let resized = 0
  window.addEventListener(
    'resize',
    () => {
      clearTimeout(resized)
      resized = window.setTimeout(collect, 150)
    },
    { signal },
  )
  const grown = new ResizeObserver(() => (dirty = true))
  grown.observe(app.pager)
  signal.addEventListener('abort', () => {
    cancelAnimationFrame(frame)
    clearTimeout(resized)
    grown.disconnect()
  })
}

/** What a paragraph is set in, and how wide: read before any paragraph is broken up (its lines don't change either). */
function measure(el: HTMLElement) {
  const style = getComputedStyle(el)
  const font: FontSpec = { family: style.fontFamily, weight: Number(style.fontWeight) || 400, size: parseFloat(style.fontSize), italic: style.fontStyle === 'italic' }
  return { width: el.clientWidth, lineHeight: parseFloat(style.lineHeight), font }
}

/**
 * A paragraph broken into its lines by pretext, one block per line, so each can
 * move on its own. Each line keeps its exact text (soft hyphens and all, so the
 * paragraph reads and copies the same); one that breaks at a soft hyphen shows
 * the hyphen from CSS (.drift-line.is-hyphen).
 */
function split(el: HTMLElement, { width, lineHeight, font }: ReturnType<typeof measure>) {
  const text = (el.dataset.plain ??= el.textContent ?? '')
  if (!width || !lineHeight || !text.trim()) {
    el.textContent = text
    return
  }
  const lines = layoutWithLines(prep(text, font), width, lineHeight).lines
  let at = 0
  const spans = lines.map((line, i) => {
    const start = at
    // pretext leaves soft hyphens out of a line's text, and adds a hyphen where the line breaks at one.
    const soft = line.text.endsWith('-') ? line.text.slice(0, -1) : null
    for (const ch of (soft ?? line.text).trimEnd()) {
      while (at < text.length && text[at] !== ch && (text[at] === '\u00AD' || /\s/.test(text[at]!))) at++
      if (text.startsWith(ch, at)) at += ch.length
    }
    // Broken at a soft hyphen (not after a real one, as in far-fetched): CSS shows the hyphen.
    const hyphen = soft !== null && text[at] === '\u00AD'
    if (hyphen || (soft !== null && text[at] === '-')) at++
    // The space after a line belongs to it (it's invisible there), and the last line takes whatever's left.
    while (at < text.length && /\s/.test(text[at]!)) at++
    if (i === lines.length - 1) at = text.length
    const span = document.createElement('span')
    span.className = hyphen ? 'drift-line is-hyphen' : 'drift-line'
    span.textContent = text.slice(start, at)
    return span
  })
  el.replaceChildren(...spans)
}
