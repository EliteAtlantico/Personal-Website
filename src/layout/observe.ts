// Runs a layout function now and again whenever an element's width changes,
// batched into one animation frame. Stops when the page's signal aborts.
//
// A page's first layouts can run as a batch (inWidthBatch): every element's
// width is read first, all together, and then each layout runs. Reading a
// width right after another layout has changed the page makes the browser lay
// the whole page out again, so without the batch that happened once per
// headline.

let batch: Array<{ el: HTMLElement; run: (width: number) => void }> | null = null

/** A first layout's work runs in slices this long, with a breath for the browser in between. */
const SLICE = 40

/**
 * Runs `layouts`, holding back the onWidth layouts they start until every
 * width has been read; then runs them, a slice at a time, so a page's first
 * layout is never one long task (the page stays hidden until it's done, but
 * the browser can still answer a tap or a key in between).
 */
export async function inWidthBatch(layouts: () => void) {
  const mine: NonNullable<typeof batch> = []
  batch = mine
  try {
    layouts()
  } finally {
    batch = null
  }
  const widths = mine.map(({ el }) => el.clientWidth)
  let slice = performance.now()
  for (const [i, { run }] of mine.entries()) {
    if (performance.now() - slice > SLICE) {
      await breath()
      slice = performance.now()
    }
    try {
      run(widths[i]!)
    } catch (error) {
      // One layout failing shouldn't take the others down.
      console.error(error)
    }
  }
}

/** Lets the browser do whatever's waiting (input first), then carries on. */
function breath() {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler
  return scheduler?.yield ? scheduler.yield() : new Promise<void>((resolve) => setTimeout(resolve, 0))
}

export function onWidth(el: HTMLElement, signal: AbortSignal, layout: (width: number) => void) {
  let last = 0
  const first = (width: number) => {
    last = width
    layout(width)
  }
  if (batch) batch.push({ el, run: first })
  else first(el.clientWidth)
  let frame = 0
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      const width = el.clientWidth
      if (width === last) return
      last = width
      layout(width)
    })
  })
  observer.observe(el)
  signal.addEventListener('abort', () => {
    cancelAnimationFrame(frame)
    observer.disconnect()
  })
}
