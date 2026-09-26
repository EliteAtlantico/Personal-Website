// The phone edition of the front page, like a news app's: the sections as tabs
// across the top, each one a panel, side by side in a pager that's swiped
// through (or a tab tapped). It's made from the page as rendered, before
// anything is laid out, so every layout measures its own panel. The editor's
// bio gets a tab of its own, at the end, instead of turning up between stories.
//
// Each tab keeps its own place: going back to one scrolls to where it was left,
// and a swipe shows it there as it slides in.
import { calm } from '../signals'

/** Where the front page becomes the phone edition (front.css goes to one column here too). */
export const PHONE = '(max-width: 880px)'

export interface App {
  pager: HTMLElement
  /** The panel showing now. */
  active(): HTMLElement
  /** Calls `then` whenever another panel comes to show. */
  onChange(then: (panel: HTMLElement) => void): void
}

export function arrange(page: HTMLElement, signal: AbortSignal): App | null {
  const front = page.querySelector<HTMLElement>('main.front')
  const nav = page.querySelector<HTMLElement>('.tabs')
  if (!front || !nav || !matchMedia(PHONE).matches) return null
  const tabs = [...nav.querySelectorAll<HTMLAnchorElement>('.tabs__tab')]
  if (tabs.length < 2) return null

  // What goes in each panel: the top stories (the lead, then the rail less the bio), each desk, the bio.
  const bio = front.querySelector<HTMLElement>('.bio')
  const contents = new Map<string, Element[]>([['top', [front.querySelector('.lead'), front.querySelector('.rail')].filter((el): el is Element => !!el)]])
  for (const desk of front.querySelectorAll<HTMLElement>('.desk')) {
    const id = desk.querySelector('.desk__name')?.id
    if (id) contents.set(id, [desk])
  }
  if (bio) contents.set('about', [bio])

  const pager = document.createElement('div')
  pager.className = 'pager'
  const panels = tabs.map((tab) => {
    const id = tab.dataset.panel!
    const panel = document.createElement('section')
    panel.className = 'pager__panel'
    panel.id = `panel-${id}`
    tab.id = `tab-${id}`
    panel.setAttribute('role', 'tabpanel')
    panel.setAttribute('aria-labelledby', tab.id)
    panel.append(...(contents.get(id) ?? []))
    tab.setAttribute('role', 'tab')
    tab.setAttribute('aria-controls', panel.id)
    return panel
  })
  // The top stories end by pointing to the editor's own tab.
  const about = tabs.findIndex((tab) => tab.dataset.panel === 'about')
  if (about > 0) panels[0]!.insertAdjacentHTML('beforeend', `<p class="pager__about"><a href="#about">About the editor →</a></p>`)
  nav.setAttribute('role', 'tablist')
  pager.append(...panels)
  front.replaceChildren(pager)
  front.classList.add('is-app')

  // --- Which panel shows ---
  let current = -1
  const listeners: Array<(panel: HTMLElement) => void> = []
  /** How far down each panel its reader had got (px below the tabs). */
  const places = new Map<number, number>()
  /** How far down the panel showing the reader is (0 while the masthead's still in view). */
  const depth = () => Math.max(0, nav.getBoundingClientRect().bottom - pager.getBoundingClientRect().top)
  const leftOf = (i: number) => panels[i]!.offsetLeft - panels[0]!.offsetLeft
  const fit = () => {
    const panel = panels[current]
    if (panel) pager.style.height = `${panel.offsetHeight}px`
  }
  /**
   * The panels off to the sides, ready for a swipe: each is shifted so the place its reader left it
   * lines up with the screen (its top, the first time). It slides in showing that, and when it takes
   * over, the page scrolls to the same spot as the shift comes off, so nothing jumps.
   */
  let posed = ''
  const pose = () => {
    const deep = depth()
    const at = `${current}|${deep}`
    if (at === posed) return
    posed = at
    panels.forEach((panel, k) => (panel.style.translate = k === current || !deep ? '' : `0 ${(deep - (places.get(k) ?? 0)).toFixed(1)}px`))
  }
  const show = (i: number) => {
    if (i === current || !panels[i]) return
    const deep = depth()
    const base = window.scrollY - deep
    if (current >= 0) places.set(current, deep)
    current = i
    tabs.forEach((tab, t) => {
      tab.setAttribute('aria-selected', String(t === i))
      tab.tabIndex = t === i ? 0 : -1
    })
    // Only the panel showing can be reached (by Tab, or a screen reader); the others are only seen, mid-swipe.
    panels.forEach((panel, k) => (panel.inert = k !== i))
    fit()
    if (deep) window.scrollTo({ top: base + (places.get(i) ?? 0), behavior: 'instant' })
    pose()
    // The strip scrolls to keep its chosen tab in view (without moving the page).
    const tab = tabs[i]!
    nav.scrollTo({ left: tab.offsetLeft - (nav.clientWidth - tab.offsetWidth) / 2, behavior: calm() ? 'instant' : 'smooth' })
    for (const listen of listeners) listen(panels[i]!)
  }
  const go = (i: number) => {
    const to = Math.max(0, Math.min(panels.length - 1, i))
    pager.scrollTo({ left: leftOf(to), behavior: calm() ? 'instant' : 'smooth' })
    show(to)
  }

  // A swipe: once the pager comes to rest on a panel, that panel's showing. (Not before: going
  // from the first tab to the last passes every panel between, and none of those is chosen.)
  let still = 0
  const settle = () => {
    clearTimeout(still)
    const i = Math.max(0, Math.min(panels.length - 1, Math.round(pager.scrollLeft / pager.clientWidth)))
    if (Math.abs(pager.scrollLeft - leftOf(i)) < 2) show(i)
  }
  pager.addEventListener(
    'scroll',
    () => {
      clearTimeout(still)
      still = window.setTimeout(settle, 120)
    },
    { passive: true, signal },
  )
  pager.addEventListener('scrollend', settle, { signal })
  // The panels to the sides keep up with the reader's place in this one.
  let posing = 0
  window.addEventListener(
    'scroll',
    () => {
      posing ||= requestAnimationFrame(() => {
        posing = 0
        pose()
      })
    },
    { passive: true, signal },
  )
  // The pager is as tall as the panel showing, so the page ends where that panel does.
  const grows = new ResizeObserver(fit)
  for (const panel of panels) grows.observe(panel)

  // Tapping a tab, or a link to one (About the editor →).
  nav.addEventListener(
    'click',
    (event) => {
      const tab = (event.target as Element).closest<HTMLAnchorElement>('.tabs__tab')
      if (!tab) return
      event.preventDefault()
      go(tabs.indexOf(tab))
    },
    { signal },
  )
  pager.addEventListener(
    'click',
    (event) => {
      const link = (event.target as Element).closest<HTMLAnchorElement>('a[href^="#"]')
      const to = link && tabs.findIndex((tab) => tab.getAttribute('href') === link.getAttribute('href'))
      if (to === null || to === undefined || to < 0) return
      event.preventDefault()
      go(to)
      tabs[to]!.focus({ preventScroll: true })
    },
    { signal },
  )
  // The keyboard: the arrow keys go from tab to tab (and show it), Home and End to the ends.
  nav.addEventListener(
    'keydown',
    (event) => {
      const at = tabs.indexOf(event.target as HTMLAnchorElement)
      const to = at < 0 ? undefined : { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: tabs.length - 1 }[event.key]
      if (to === undefined) return
      event.preventDefault()
      const i = (to + tabs.length) % tabs.length
      go(i)
      tabs[i]!.focus({ preventScroll: true })
    },
    { signal },
  )
  signal.addEventListener('abort', () => {
    clearTimeout(still)
    cancelAnimationFrame(posing)
    grows.disconnect()
  })

  show(0)
  return {
    pager,
    active: () => panels[current]!,
    onChange: (then) => void listeners.push(then),
  }
}
