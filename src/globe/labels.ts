// Which titles fit on the globe right now, and where. Every frame the dots
// are projected onto the screen and their labels are placed one at a time,
// most important first (the cities, then the story being pointed at, then
// the front page's order), each beside its dot on whichever side is free:
// right, left, above or below. A label with no room is left out; its dot
// stays, and pointing at it brings the label back.
//
// The widths come from pretext, measured once per title, so this can run on
// every frame of a turning globe without asking the browser to lay out text.

export type Side = 'right' | 'left' | 'above' | 'below'

export interface Anchor {
  id: string
  /** The dot, on screen (px). */
  x: number
  y: number
  width: number
  height: number
  /** Space between the dot and its label (px). */
  gap: number
  /** Sides to try, in order (default: right, left, above, below). */
  sides?: Side[]
}

export interface Placed {
  id: string
  x: number
  y: number
  width: number
  height: number
  side: Side
}

/** Labels for as many anchors as fit, in the order given, none overlapping and all inside the bounds. */
export function placeLabels(anchors: Anchor[], bounds: { width: number; height: number }, pad = 3): Placed[] {
  const placed: Placed[] = []
  const free = (box: Omit<Placed, 'id' | 'side'>) =>
    box.x >= 0 &&
    box.y >= 0 &&
    box.x + box.width <= bounds.width &&
    box.y + box.height <= bounds.height &&
    placed.every((other) => box.x + box.width + pad <= other.x || other.x + other.width + pad <= box.x || box.y + box.height + pad <= other.y || other.y + other.height + pad <= box.y)
  for (const anchor of anchors) {
    for (const side of anchor.sides ?? (['right', 'left', 'above', 'below'] as const)) {
      const box = at(anchor, side)
      if (free(box)) {
        placed.push({ id: anchor.id, side, ...box })
        break
      }
    }
  }
  return placed
}

function at({ x, y, width, height, gap }: Anchor, side: Side) {
  switch (side) {
    case 'right':
      return { x: x + gap, y: y - height / 2, width, height }
    case 'left':
      return { x: x - gap - width, y: y - height / 2, width, height }
    case 'above':
      return { x: x - width / 2, y: y - gap - height, width, height }
    case 'below':
      return { x: x - width / 2, y: y + gap, width, height }
  }
}
