// Runs a layout function now and again whenever an element's width changes,
// batched into one animation frame. Stops when the page's signal aborts.

export function onWidth(el: HTMLElement, signal: AbortSignal, layout: (width: number) => void) {
  let last = el.clientWidth
  layout(last)
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
