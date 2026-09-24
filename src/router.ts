// Client-side navigation between the front page and stories.
//
// Without JavaScript every tile is a plain link to a prerendered page. With it,
// clicks are intercepted and the new page is rendered in place: the old page
// fades out while each word of the clicked tile's headline and dek flies to its
// place in the article header (see layout/morph.ts), and back again.
import type { Site } from './content/types'
import { enhance } from './enhance'
import { assembleHeadlines } from './layout/assemble'
import { captureMorph, morph, type Morph } from './layout/morph'
import { renderPage } from './render/document'
import { findItem, isRoute, normalizePath, VIEW_PATHS } from './render/paths'
import { calm, choose, type Edition } from './signals'
import type { View } from './signals/decide'

interface NavState {
  /** Where the visitor was when they opened this entry, so Esc can go "back" instead of "forward to /". */
  from?: string
  /** Scroll position to restore when returning to this entry. */
  scrollY?: number
}

let go: ((to: string) => void) | null = null

/** Shows a page of the site, as if a link to it had been clicked (the terminal's `open` uses this). */
export function navigate(to: string) {
  const path = normalizePath(to)
  if (go) go(path)
  else location.assign(path)
}

/** `site` is this visitor's edition of the site (src/signals); it changes if they change their mind. */
export function startRouter(edition: Site, first: HTMLElement) {
  const app = first.parentElement
  if (!app) return
  let site = edition
  history.scrollRestoration = 'manual'
  let current = normalizePath(location.pathname)
  let page = first
  let controller = new AbortController()
  let running: Morph | null = null
  // The front page's load-in animations (the banner's letters, the bio's snowfall and
  // the headlines' swarm) play only on the page that was loaded: a first visit or a
  // reload, never when coming back from an article. Pages the router renders later
  // aren't marked, so they appear already in place. (Nor is a page that should keep
  // still: reduced motion, low battery, Save-Data.)
  if (!calm()) first.dataset.intro = ''
  void enhance(page, controller.signal, site).then(() => {
    document.documentElement.classList.remove('pt-pending')
    assembleHeadlines(page)
  })

  go = (to) => {
    if (to === current) return
    history.replaceState({ ...(history.state as NavState | null), scrollY: window.scrollY } satisfies NavState, '')
    history.pushState({ from: current } satisfies NavState, '', to)
    void show(to, { forward: true })
  }

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const link = (event.target as Element | null)?.closest?.('a')
    if (!link || link.target || link.hasAttribute('download')) return
    // Switching views is a choice worth remembering: next time, the site opens there.
    if (link.dataset.view) void choose({ view: link.dataset.view as View })
    const url = new URL(link.href, location.href)
    if (url.origin !== location.origin || url.hash || !isRoute(site, url.pathname)) return
    event.preventDefault()
    go?.(normalizePath(url.pathname))
  })

  // The visitor changed their mind about personalizing: the same page, laid out again, where they were.
  document.addEventListener('kc:edition', (event) => {
    site = (event as CustomEvent<Edition>).detail.site
    running?.finish()
    const scroll = window.scrollY
    const next = renderPage(site, current)
    const template = document.createElement('template')
    template.innerHTML = next.html
    const fresh = template.content.firstElementChild as HTMLElement
    controller.abort()
    controller = new AbortController()
    page.replaceWith(fresh)
    page = fresh
    void enhance(page, controller.signal, site).then(() => window.scrollTo(0, scroll))
  })

  window.addEventListener('popstate', (event) => {
    void show(normalizePath(location.pathname), { forward: false, scrollY: (event.state as NavState | null)?.scrollY })
  })

  // Esc closes a story: back to wherever it was opened from (the front page, another story),
  // or to the front page if it was the first page of the visit. The views themselves stay put.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || VIEW_PATHS.includes(current) || event.defaultPrevented) return
    if ((history.state as NavState | null)?.from) history.back()
    else go?.('/')
  })

  async function show(to: string, { forward, scrollY = 0 }: { forward: boolean; scrollY?: number }) {
    running?.finish()
    const fromSlug = findItem(site, current)?.slug
    current = to
    const next = renderPage(site, to)
    const motion = !document.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches
    // Which story morphs: the one being opened going forward, the one being closed going back.
    const slug = forward ? (next.slug ?? fromSlug) : (fromSlug ?? next.slug)

    // Snapshot the morph's starting point, then pin the old page in place so it can fade out on top.
    const old = page
    const source = motion && slug ? captureMorph(storyIn(old, slug)) : null
    Object.assign(old.style, { position: 'fixed', top: `${-window.scrollY}px`, left: '0', right: '0', zIndex: '2', pointerEvents: 'none' })

    const template = document.createElement('template')
    template.innerHTML = next.html
    page = template.content.firstElementChild as HTMLElement
    app!.append(page)
    document.title = next.title

    controller.abort()
    controller = new AbortController()
    await enhance(page, controller.signal, site)
    window.scrollTo(0, next.kind === 'front' ? scrollY : 0)
    focusAfter(page, next.kind === 'front' ? fromSlug : undefined)

    if (!motion) {
      old.remove()
      return
    }
    const target = source ? captureMorph(storyIn(page, slug!)) : null
    const fadeOut = old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-out', fill: 'forwards' })
    page.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, delay: 40, easing: 'ease-out', fill: 'backwards' })
    running = source && target ? morph(source, target) : null
    const settled = Promise.all([fadeOut.finished.catch(() => undefined), running?.done])
    await Promise.race([settled, new Promise((resolve) => setTimeout(resolve, 900))])
    running?.finish()
    old.remove()
  }
}

/** The morphing element for a story: its open article header, or its tile. */
function storyIn(page: HTMLElement, slug: string) {
  const s = CSS.escape(slug)
  return page.querySelector(`.story[data-slug="${s}"] .story__head`) ?? page.querySelector(`.tile[data-slug="${s}"]`)
}

function focusAfter(page: HTMLElement, tileSlug: string | undefined) {
  const target = tileSlug
    ? page.querySelector<HTMLElement>(`.tile[data-slug="${CSS.escape(tileSlug)}"] .tile__link`)
    : page.querySelector<HTMLElement>('.story__headline')
  target?.focus({ preventScroll: true })
}
