// Progressive enhancement for a freshly inserted page. Everything here is
// optional: without JavaScript (or without pretext support) the page is
// already complete, just laid out by plain CSS.
import { layoutBio } from './layout/bio'
import { fontsReady } from './layout/fonts'
import { layoutHeadlines } from './layout/headlines'
import { layoutLead } from './layout/lead'
import { inWidthBatch } from './layout/observe'
import { layoutDesks } from './layout/masonry'
import { layoutPortrait } from './layout/portrait'
import type { Site } from './content/types'
import { formatDate } from './render/html'
import { calm } from './signals'
import { addNote } from './ui/note'
import { arrange } from './layout/app'
import { drift } from './layout/drift'

/** `site` is the visitor's edition of it (src/signals), which the terminal lays its dashboard out from. */
export async function enhance(page: HTMLElement, signal: AbortSignal, site: Site) {
  // The prerendered masthead carries the build date; show the visitor's own date instead.
  for (const el of page.querySelectorAll<HTMLElement>('[data-today]')) el.textContent = formatDate(new Date().toISOString())
  // What personalizing noticed and changed, under the front page's masthead.
  if (page.classList.contains('page--front')) addNote(page, signal)
  // On a phone, the front page becomes the app: tabs over panels, before anything is laid out in them.
  const app = page.classList.contains('page--front') ? arrange(page, signal) : null
  videoFacades(page)
  coverVideos(page, signal)

  // The terminal measures only its monospace; every other page, the paper's fonts.
  const terminal = page.querySelector<HTMLElement>('.terminal')
  if (await fontsReady(terminal ? 'mono' : 'paper')) {
    if (signal.aborted) return
    // Each layout is independent; one failing shouldn't take the others down. Their widths are
    // all read first, together (see observe.ts), instead of one forced layout per headline.
    await inWidthBatch(() => {
      for (const layout of [layoutHeadlines, layoutDesks, layoutBio, layoutLead, layoutPortrait]) {
        try {
          layout(page, signal)
        } catch (error) {
          console.error(error)
        }
      }
    })
    // The phone edition's text flows with the scroll, once its lines are laid out.
    if (app && !signal.aborted) drift(page, signal, app)
  } else {
    // No pretext layout, so no typographic banner: show the photo itself.
    page.querySelector('.masthead__banner')?.classList.add('is-photo')
  }

  // The front page's globe (WebGL, a chunk of its own) loads as its tile nears the screen, on a
  // device that can take it and with pretext to measure its labels. Without it, the tile says in words
  // where the stories happened.
  const globe = page.querySelector<HTMLElement>('.page--front [data-globe]')
  if (globe && sturdy() && !signal.aborted && (await fontsReady())) {
    const near = new IntersectionObserver(
      async ([entry]) => {
        if (!entry?.isIntersecting) return
        near.disconnect()
        try {
          const { mountGlobe } = await import('./globe')
          if (signal.aborted) return
          // Picking a dot follows the story's link in the tile, so the router opens it like any tile.
          const mounted = mountGlobe(globe, { site, mode: 'embed', open: (item) => globe.querySelector<HTMLAnchorElement>(`a[data-slug="${CSS.escape(item.slug)}"]`)?.click() })
          signal.addEventListener('abort', () => mounted?.dispose())
        } catch (error) {
          console.error(error)
        }
      },
      { rootMargin: '600px 0px' },
    )
    near.observe(globe)
    signal.addEventListener('abort', () => near.disconnect())
  }

  // The terminal view's shell is its own chunk, fetched only when someone opens it.
  if (terminal && !signal.aborted) {
    try {
      const { mountTerminal } = await import('./terminal')
      if (!signal.aborted) mountTerminal(terminal, signal, site)
    } catch (error) {
      if (!reloadForNewBuild(error)) console.error(error)
    }
  }
  page.querySelector('main')?.setAttribute('data-laid-out', '')
}

/**
 * Cloudflare keeps only the newest build's files, so a page opened before a
 * deploy asks for a chunk that's gone. The page loaded afresh names the new
 * one: reload, once (a page that was just reloaded and still can't find it
 * has another problem).
 */
function reloadForNewBuild(error: unknown) {
  const gone = error instanceof TypeError && /dynamically imported module|Importing a module script failed/i.test(error.message)
  const reloaded = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type === 'reload'
  if (!gone || reloaded) return false
  location.reload()
  return true
}

/** Whether the device can take a WebGL globe: not on very little memory, two cores or less, or Save-Data. */
export function sturdy() {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } }
  return (nav.deviceMemory ?? 8) > 2 && (navigator.hardwareConcurrency || 8) > 2 && nav.connection?.saveData !== true
}

/** YouTube embeds load only when the visitor clicks play (privacy-enhanced mode). */
function videoFacades(page: HTMLElement) {
  for (const link of page.querySelectorAll<HTMLAnchorElement>('a[data-youtube]')) {
    link.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      const frame = document.createElement('iframe')
      frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(link.dataset.youtube ?? '')}?autoplay=1`
      frame.title = link.getAttribute('aria-label') ?? 'Video'
      frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'
      frame.className = 'video__frame'
      link.replaceWith(frame)
    })
  }
}

/** Cover videos loop silently while on screen, unless the page should keep still (reduced motion, low battery, Save-Data). */
function coverVideos(page: HTMLElement, signal: AbortSignal) {
  const videos = [...page.querySelectorAll<HTMLVideoElement>('video[data-autoplay]')]
  if (!videos.length || calm()) return
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const video = entry.target as HTMLVideoElement
      if (entry.isIntersecting) void video.play().catch(() => undefined)
      else video.pause()
    }
  })
  for (const video of videos) observer.observe(video)
  signal.addEventListener('abort', () => observer.disconnect())
}
