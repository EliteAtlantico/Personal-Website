// Copyfits headlines: each one is set at the largest size that fills its
// column in the preferred number of lines, with balanced line lengths.
// The lines are written out with <br>, so what the browser draws is exactly
// what pretext computed (the morph animation relies on that).
import { FAMILY, applyFont } from './fonts'
import { onWidth } from './observe'
import { copyfit, type Fit } from './text'

export type HeadlineKind = 'lead' | 'story' | 'brief' | 'rail' | 'article'

interface Style {
  min: number
  max: number
  /** Preferred maximum line counts, in order. */
  lines: number[]
  lineHeight: number
  /** letter-spacing in em */
  tracking: number
}

const STYLES: Record<HeadlineKind, Style> = {
  lead: { min: 40, max: 80, lines: [1, 2], lineHeight: 1.02, tracking: -0.015 },
  story: { min: 20, max: 29, lines: [2, 3], lineHeight: 1.12, tracking: -0.005 },
  brief: { min: 17, max: 22, lines: [2, 3], lineHeight: 1.15, tracking: 0 },
  rail: { min: 19, max: 25, lines: [2, 3], lineHeight: 1.12, tracking: -0.005 },
  article: { min: 34, max: 76, lines: [2, 3], lineHeight: 1.02, tracking: -0.02 },
}

export function fitHeadline(el: HTMLElement, kind: HeadlineKind, width: number): Fit | null {
  // Remember the original text: after the first fit the element contains <br>s.
  const text = (el.dataset.text ??= (el.textContent ?? '').replace(/\s+/g, ' ').trim())
  if (!text || width < 40) return null
  const style = STYLES[kind]
  const min = kind === 'article' && width < 480 ? 28 : style.min
  const fit = copyfit(text, { family: FAMILY.display, weight: 700, tracking: style.tracking }, { ...style, min, width })

  applyFont(el, fit.font, fit.lineHeight)
  el.style.whiteSpace = 'nowrap'
  el.replaceChildren(
    ...fit.lines.flatMap((line, i) => {
      const words = document.createTextNode(line.text.trimEnd())
      return i === 0 ? [words] : [document.createElement('br'), words]
    }),
  )
  el.dataset.fitWidth = String(width)
  return fit
}

/** Headlines outside the desks (lead, secondary, rail, article), refit when their column resizes. */
export function layoutHeadlines(page: HTMLElement, signal: AbortSignal) {
  const targets: Array<[string, HeadlineKind]> = [
    ['.tile--lead .tile__headline', 'lead'],
    ['.lead__secondary .tile__headline', 'story'],
    ['.rail .tile--rail .tile__headline', 'rail'],
    ['.story__headline', 'article'],
  ]
  for (const [selector, kind] of targets) {
    for (const el of page.querySelectorAll<HTMLElement>(selector)) {
      const column = el.parentElement
      if (column) onWidth(column, signal, (width) => fitHeadline(el, kind, width))
    }
  }
}
