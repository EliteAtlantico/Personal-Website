// Runs a layout function now and again whenever an element's width changes,
// batched into one animation frame. Stops when the page's signal aborts.
//
// A page's first layouts can run as a batch (inWidthBatch): every element's
// width is read first, all together, and then each layout runs. Reading a
// width right after another layout has changed the page makes the browser lay
// the whole page out again, so without the batch that happened once per
// headline.

let batch: Array<{ el: HTMLElement; run: (width: number) => void }> | null = null

/** Runs `layouts`, holding back the onWidth layouts they start until every width has been read. */
export function inWidthBatch(layouts: () => void) {
  const mine: NonNullable<typeof batch> = []
  batch = mine
  try {
    layouts()
  } finally {
    batch = null
    const widths = mine.map(({ el }) => el.clientWidth)
    mine.forEach(({ run }, i) => {
      try {
        run(widths[i]!)
      } catch (error) {
        // One layout failing shouldn't take the others down.
        console.error(error)
      }
    })
  }
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
