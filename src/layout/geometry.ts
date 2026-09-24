// Shapes, from the point of view of one line of text: for the horizontal band
// a line occupies (top..bottom), which x-ranges are blocked or allowed?

export interface Interval {
  left: number
  right: number
}

export interface Point {
  x: number
  y: number
}

/** Anything text flows around. Returns the x-range it blocks in the band, or null. */
export interface Obstacle {
  band(top: number, bottom: number): Interval | null
}

/** Removes blocked ranges from a line's base range, keeping slots at least minWidth wide. */
export function carve(base: Interval, blocked: Array<Interval | null>, minWidth = 24): Interval[] {
  let slots = [base]
  for (const block of blocked) {
    if (!block) continue
    const next: Interval[] = []
    for (const slot of slots) {
      if (block.right <= slot.left || block.left >= slot.right) {
        next.push(slot)
        continue
      }
      if (block.left > slot.left) next.push({ left: slot.left, right: block.left })
      if (block.right < slot.right) next.push({ left: block.right, right: slot.right })
    }
    slots = next
  }
  return slots.filter((slot) => slot.right - slot.left >= minWidth).sort((a, b) => a.left - b.left)
}

export function intersect(a: Interval | null, b: Interval | null): Interval | null {
  if (!a || !b) return null
  const left = Math.max(a.left, b.left)
  const right = Math.min(a.right, b.right)
  return left < right ? { left, right } : null
}

/** Where a horizontal line at height y crosses a convex polygon. */
export function crossSection(poly: Point[], y: number): Interval | null {
  let left = Infinity
  let right = -Infinity
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    if ((a.y <= y && b.y >= y) || (b.y <= y && a.y >= y)) {
      const x = a.y === b.y ? Math.min(a.x, b.x) : a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x)
      const x2 = a.y === b.y ? Math.max(a.x, b.x) : x
      left = Math.min(left, x, x2)
      right = Math.max(right, x, x2)
    }
  }
  return left <= right ? { left, right } : null
}

/**
 * The x-range where a whole band fits *inside* a convex polygon (the text
 * must stay inside a silhouette for the full height of the line).
 */
export function insideBand(poly: Point[], top: number, bottom: number): Interval | null {
  let range = intersect(crossSection(poly, top), crossSection(poly, bottom))
  for (const p of poly) if (p.y > top && p.y < bottom) range = intersect(range, crossSection(poly, p.y))
  return range
}

/** The x-range a convex polygon covers anywhere within a band (what it blocks). */
export function coverBand(poly: Point[], top: number, bottom: number): Interval | null {
  let left = Infinity
  let right = -Infinity
  const take = (x: number) => {
    left = Math.min(left, x)
    right = Math.max(right, x)
  }
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    if (a.y >= top && a.y <= bottom) take(a.x)
    for (const y of [top, bottom]) {
      if ((a.y - y) * (b.y - y) < 0) take(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x))
    }
  }
  return left <= right ? { left, right } : null
}

export function polygonObstacle(poly: Point[], pad = 0): Obstacle {
  return {
    band(top, bottom) {
      const hit = coverBand(poly, top - pad, bottom + pad)
      return hit ? { left: hit.left - pad, right: hit.right + pad } : null
    },
  }
}

export function circleObstacle(cx: number, cy: number, r: number, pad = 0): Obstacle {
  return {
    band(top, bottom) {
      // The widest chord of the circle inside the band.
      const dy = cy >= top && cy <= bottom ? 0 : Math.min(Math.abs(top - cy), Math.abs(bottom - cy))
      if (dy >= r + pad) return null
      const half = Math.sqrt((r + pad) ** 2 - dy ** 2)
      return { left: cx - half, right: cx + half }
    },
  }
}

export function rectObstacle(x: number, y: number, w: number, h: number, pad = 0): Obstacle {
  return {
    band(top, bottom) {
      if (bottom <= y - pad || top >= y + h + pad) return null
      return { left: x - pad, right: x + w + pad }
    },
  }
}

/** Corners of a w×h rectangle rotated by `degrees` around its centre, placed at (x, y). */
export function rotatedRect(x: number, y: number, w: number, h: number, degrees: number): Point[] {
  const cx = x + w / 2
  const cy = y + h / 2
  const t = (degrees * Math.PI) / 180
  const cos = Math.cos(t)
  const sin = Math.sin(t)
  return [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([dx, dy]) => ({ x: cx + dx! * cos - dy! * sin, y: cy + dx! * sin + dy! * cos }))
}
