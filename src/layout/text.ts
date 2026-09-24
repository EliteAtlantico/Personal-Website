// Thin helpers over pretext: cached preparation, balanced line breaking and
// headline copyfitting. All pure arithmetic after the first measurement.
import { layoutWithLines, measureLineStats, prepareWithSegments, walkLineRanges, type LayoutLine, type PreparedTextWithSegments } from '@chenglou/pretext'
import { canvasFont, trackingPx, type FontSpec } from './fonts'

const cache = new Map<string, PreparedTextWithSegments>()

/** pretext's prepare() is the expensive step; do it once per (text, font). */
export function prep(text: string, font: FontSpec): PreparedTextWithSegments {
  const css = canvasFont(font)
  const letterSpacing = trackingPx(font)
  const key = `${css}|${letterSpacing}|${text}`
  let prepared = cache.get(key)
  if (!prepared) {
    // Copyfitting tries many sizes; keep the cache bounded.
    if (cache.size > 1500) cache.clear()
    prepared = prepareWithSegments(text, css, letterSpacing ? { letterSpacing } : undefined)
    cache.set(key, prepared)
  }
  return prepared
}

/** True if some line would have to break inside a word at this width. */
export function breaksWord(prepared: PreparedTextWithSegments, width: number) {
  let broken = false
  walkLineRanges(prepared, width, (line) => {
    if (line.end.graphemeIndex !== 0) broken = true
  })
  return broken
}

export interface Lines {
  lines: LayoutLine[]
  /** The width the lines were broken at (≤ the width asked for). */
  width: number
}

/**
 * The most even line lengths for this line count: the narrowest width that
 * doesn't add a line. What CSS `text-wrap: balance` does, for any length.
 */
export function balancedLines(prepared: PreparedTextWithSegments, maxWidth: number, lineHeight: number): Lines {
  const target = measureLineStats(prepared, maxWidth).lineCount
  let hi = maxWidth
  if (target > 1) {
    let lo = maxWidth / (target + 1)
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2
      if (measureLineStats(prepared, mid).lineCount > target || breaksWord(prepared, mid)) lo = mid
      else hi = mid
    }
  }
  return { lines: layoutWithLines(prepared, hi, lineHeight).lines, width: hi }
}

export interface Fit extends Lines {
  font: FontSpec
  lineHeight: number
}

export interface FitOptions {
  /** Font size range in px. */
  min: number
  max: number
  /** Preferred maximum line counts, tried in order (e.g. [2, 3]). */
  lines: number[]
  lineHeight: number
  width: number
}

/**
 * Newspaper copyfitting: the largest size (in half-pixel steps) at which the
 * headline fits the column in the preferred number of lines without breaking
 * a word, then balanced so the lines come out even.
 */
export function copyfit(text: string, base: Omit<FontSpec, 'size'>, opts: FitOptions): Fit {
  const fitsAt = (halfPx: number, maxLines: number) => {
    const prepared = prep(text, { ...base, size: halfPx / 2 })
    return measureLineStats(prepared, opts.width).lineCount <= maxLines && !breaksWord(prepared, opts.width)
  }
  let size = opts.min
  for (const maxLines of opts.lines) {
    let lo = Math.round(opts.min * 2)
    let hi = Math.round(opts.max * 2)
    if (!fitsAt(lo, maxLines)) continue
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2)
      if (fitsAt(mid, maxLines)) lo = mid
      else hi = mid - 1
    }
    size = lo / 2
    break
  }
  const font = { ...base, size }
  const lineHeight = Math.round(size * opts.lineHeight * 10) / 10
  return { font, lineHeight, ...balancedLines(prep(text, font), opts.width, lineHeight) }
}
