// The lead story's opening is ordinary text in two CSS columns. This only
// decides how much of it to show: enough whole lines that the lead column
// ends level with the rail beside it, then "Continued inside".
import { onWidth } from './observe'

/** On phones (no rail beside the lead) the front page carries this many lines. */
const PHONE_LINES = 14
const MIN_LINES = 6

export function layoutLead(page: HTMLElement, signal: AbortSignal) {
  const text = page.querySelector<HTMLElement>('.jump__text')
  const lead = page.querySelector<HTMLElement>('.lead')
  const rail = page.querySelector<HTMLElement>('.rail')
  if (!text || !lead) return

  const fit = () => {
    // Natural height first: balanced columns holding all the text.
    text.style.height = ''
    text.classList.remove('is-clipped')
    const lineHeight = parseFloat(getComputedStyle(text).lineHeight)
    const natural = text.offsetHeight
    // No rail beside it (a narrow screen, or the phone edition, which has none): a phone's worth.
    const sideBySide = !!rail && rail.getBoundingClientRect().left >= lead.getBoundingClientRect().right - 1
    const target = sideBySide
      ? natural + (rail!.lastElementChild?.getBoundingClientRect().bottom ?? 0) - (lead.lastElementChild?.getBoundingClientRect().bottom ?? 0)
      : lineHeight * PHONE_LINES
    const lines = Math.max(MIN_LINES, Math.floor(target / lineHeight))
    // Safari sometimes balances the columns too short (after a resize, say): the text they can't hold
    // goes on in more columns to the right, over the rail, and the natural height is wrong. Then it's
    // cut too, at the rail's depth.
    const spilled = text.scrollWidth > text.clientWidth + 1
    // Whole lines only, so the cut falls cleanly between lines like a newspaper jump.
    if (lines * lineHeight < natural - 1 || spilled) {
      text.style.height = `${lines * lineHeight}px`
      text.classList.add('is-clipped')
    }
  }

  onWidth(lead, signal, fit)
  // The rail's stories change height as they lay out (fonts, copyfit, the bio chip): rebalance.
  let frame = 0
  let last = ''
  const observer = new ResizeObserver(() => {
    const key = [...(rail?.children ?? [])].map((el) => (el as HTMLElement).offsetHeight).join()
    if (key === last) return
    last = key
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(fit)
  })
  for (const child of rail?.children ?? []) observer.observe(child)
  signal.addEventListener('abort', () => {
    cancelAnimationFrame(frame)
    observer.disconnect()
  })
}
