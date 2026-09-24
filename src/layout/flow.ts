// Flows paragraphs through columns ("regions"), line by line, around
// obstacles and inside optional silhouettes. This is the core trick CSS can't
// do: every line gets its own width, recomputed as fast as you can drag.
import { layoutNextLine, layoutNextLineRange, type LayoutCursor, type PreparedTextWithSegments } from '@chenglou/pretext'
import { carve, intersect, type Interval, type Obstacle } from './geometry'

export interface Region {
  x: number
  y: number
  width: number
  height: number
}

export interface FlowOptions {
  regions: Region[]
  lineHeight: number
  obstacles?: Obstacle[]
  /** For silhouettes: the x-range text may use in a band (null = none). */
  allowed?: (top: number, bottom: number) => Interval | null
  /** First-line indent for every paragraph after the first (newspaper style). */
  indent?: number
  /** Narrowest slot worth putting words in. */
  minSlot?: number
}

export interface PositionedLine {
  x: number
  y: number
  text: string
  /** Natural width of the words. */
  width: number
  /** Width of the slot the line sits in (for justification). */
  slot: number
  /** Last line of its paragraph (never justified). */
  last: boolean
}

export interface FlowResult {
  lines: PositionedLine[]
  /** Everything fit. */
  done: boolean
  /** Bottom of the lowest line. */
  bottom: number
}

const START: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }

export function flow(paragraphs: PreparedTextWithSegments[], opts: FlowOptions): FlowResult {
  const { lineHeight, obstacles = [], indent = 0, minSlot = 28 } = opts
  const lines: PositionedLine[] = []
  let p = 0
  let cursor = START
  let bottom = 0
  // Skip empty paragraphs up front.
  while (p < paragraphs.length && layoutNextLineRange(paragraphs[p]!, START, 1e9) === null) p++

  for (const region of opts.regions) {
    for (let top = region.y; top + lineHeight <= region.y + region.height + 0.5; top += lineHeight) {
      if (p >= paragraphs.length) return { lines, done: true, bottom }
      const column: Interval = { left: region.x, right: region.x + region.width }
      const base = opts.allowed ? intersect(opts.allowed(top, top + lineHeight), column) : column
      if (!base) continue
      const slots = carve(base, obstacles.map((o) => o.band(top, top + lineHeight)), minSlot)
      for (const slot of slots) {
        if (p >= paragraphs.length) break
        const paragraph = paragraphs[p]!
        const inset = indent && p > 0 && cursor === START ? indent : 0
        const line = layoutNextLine(paragraph, cursor, slot.right - slot.left - inset)
        if (!line) break
        cursor = line.end
        const last = layoutNextLineRange(paragraph, cursor, 1e9) === null
        lines.push({ x: slot.left + inset, y: top, text: line.text, width: line.width, slot: slot.right - slot.left - inset, last })
        bottom = top + lineHeight
        if (last) {
          p++
          cursor = START
        }
      }
    }
  }
  return { lines, done: p >= paragraphs.length, bottom }
}

/**
 * Binary-searches the shortest column height that fits all the text, the
 * way newspapers balance columns. `regionsAt(h)` builds the columns for a
 * candidate height.
 */
export function fitHeight(
  paragraphs: PreparedTextWithSegments[],
  opts: Omit<FlowOptions, 'regions'>,
  regionsAt: (height: number) => Region[],
  { min, max }: { min: number; max: number },
): { height: number; result: FlowResult } {
  let lo = min
  let hi = max
  let result = flow(paragraphs, { ...opts, regions: regionsAt(hi) })
  if (!result.done) return { height: hi, result }
  for (let i = 0; i < 16 && hi - lo > 1; i++) {
    const mid = (lo + hi) / 2
    const attempt = flow(paragraphs, { ...opts, regions: regionsAt(mid) })
    if (attempt.done) {
      hi = mid
      result = attempt
    } else lo = mid
  }
  return { height: hi, result }
}
