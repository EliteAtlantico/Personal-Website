// Newspaper columns for the desks: stories stack down columns instead of
// sitting in rows, so there are no ragged gaps. Headlines are copyfitted to
// the column first, then tiles are packed and the columns "feathered" so
// they end flush.
import { fitHeadline, type HeadlineKind } from './headlines'
import { onWidth } from './observe'

export interface PackItem {
  span: number
  height: number
}

export interface Placement {
  col: number
  span: number
  x: number
  y: number
  width: number
}

/**
 * Skyline packing, in order: each tile goes wherever the columns under it
 * are lowest (leftmost on ties), so the first stories stay at the top.
 * `feather` is the most extra space (px) to add between stories so that
 * columns end at the same depth; only applied when nothing spans columns.
 */
export function pack(items: PackItem[], cols: number, colWidth: number, feather = 0): { placements: Placement[]; height: number } {
  const bottoms = new Array<number>(cols).fill(0)
  const placements = items.map((item): Placement => {
    const span = Math.max(1, Math.min(item.span, cols))
    let col = 0
    let y = Infinity
    for (let c = 0; c + span <= cols; c++) {
      const top = Math.max(...bottoms.slice(c, c + span))
      if (top < y - 0.5) {
        y = top
        col = c
      }
    }
    for (let c = col; c < col + span; c++) bottoms[c] = y + item.height
    return { col, span, x: col * colWidth, y, width: span * colWidth }
  })
  const height = Math.max(0, ...bottoms)

  if (feather > 0 && placements.every((p) => p.span === 1)) {
    for (let c = 0; c < cols; c++) {
      const column = placements.filter((p) => p.col === c).sort((a, b) => a.y - b.y)
      if (column.length < 2) continue
      const gap = Math.min(feather, (height - bottoms[c]!) / (column.length - 1))
      column.forEach((p, k) => (p.y += gap * k))
    }
  }
  return { placements, height }
}

export function layoutDesks(page: HTMLElement, signal: AbortSignal) {
  for (const grid of page.querySelectorAll<HTMLElement>('.desk__grid')) {
    const frame = grid.parentElement
    if (frame) onWidth(frame, signal, (width) => layoutGrid(grid, width))
  }
}

function layoutGrid(grid: HTMLElement, width: number) {
  const tiles = [...grid.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el.classList.contains('tile'))
  if (!tiles.length) return
  const brief = grid.closest('.desk--brief') !== null
  const kind: HeadlineKind = brief ? 'brief' : 'story'
  const cols = Math.max(1, Math.floor(width / (brief ? 210 : 260)))
  const colWidth = width / cols

  // Horizontal chrome inside a tile (padding + the 1px column rule).
  const style = getComputedStyle(tiles[0]!)
  const chrome = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + parseFloat(style.borderLeftWidth)

  if (cols === 1) {
    grid.classList.remove('is-masonry', 'is-settled')
    grid.style.height = ''
    for (const tile of tiles) {
      tile.style.width = ''
      tile.style.transform = ''
      fitTile(tile, kind, width - chrome)
    }
    return
  }

  grid.classList.add('is-masonry')
  const spans = tiles.map((tile) => Math.min(Number(tile.dataset.span) || 1, cols))
  tiles.forEach((tile, i) => {
    tile.style.width = `${spans[i]! * colWidth}px`
    fitTile(tile, kind, spans[i]! * colWidth - chrome)
  })
  // One read pass for every height, then one write pass for every position.
  const heights = tiles.map((tile) => tile.offsetHeight)
  const { placements, height } = pack(
    tiles.map((_, i) => ({ span: spans[i]!, height: heights[i]! })),
    cols,
    colWidth,
    28,
  )
  placements.forEach((p, i) => (tiles[i]!.style.transform = `translate(${p.x.toFixed(2)}px, ${p.y.toFixed(2)}px)`))
  grid.style.height = `${Math.ceil(height)}px`
  // Animate later re-layouts (window resizes), but not the first placement.
  requestAnimationFrame(() => grid.classList.add('is-settled'))
}

function fitTile(tile: HTMLElement, kind: HeadlineKind, width: number) {
  const headline = tile.querySelector<HTMLElement>('.tile__headline')
  if (headline) fitHeadline(headline, kind, width)
}
