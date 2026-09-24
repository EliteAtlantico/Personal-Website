// Progressive enhancement for a freshly inserted page. Everything here is
// optional: without JavaScript (or without pretext support) the page is
// already complete, just laid out by plain CSS.
import { layoutBio } from './layout/bio'
import { fontsReady } from './layout/fonts'
import { layoutHeadlines } from './layout/headlines'
import { layoutLead } from './layout/lead'
import { layoutDesks } from './layout/masonry'
import { layoutPortrait } from './layout/portrait'
import type { Site } from './content/types'
import { formatDate } from './render/html'
import { calm } from './signals'
import { addNote } from './ui/note'

/** `site` is the visitor's edition of it (src/signals), which the terminal lays its dashboard out from. */
export async function enhance(page: HTMLElement, signal: AbortSignal, site: Site) {
  // The prerendered masthead carries the build date; show the visitor's own date instead.
  for (const el of page.querySelectorAll<HTMLElement>('[data-today]')) el.textContent = formatDate(new Date().toISOString())
  // What personalizing noticed and changed, under the front page's masthead.
  if (page.classList.contains('page--front')) addNote(page, signal)
  videoFacades(page)
  coverVideos(page, signal)

  if (await fontsReady()) {
    if (signal.aborted) return
    // Each layout is independent; one failing shouldn't take the others down.
    for (const layout of [layoutHeadlines, layoutDesks, layoutBio, layoutLead, layoutPortrait]) {
      try {
        layout(page, signal)
      } catch (error) {
        console.error(error)
      }
    }
  } else {
    // No pretext layout, so no typographic banner: show the photo itself.
    page.querySelector('.masthead__banner')?.classList.add('is-photo')
  }

  // The terminal view's shell is its own chunk, fetched only when someone opens it.
  const terminal = page.querySelector<HTMLElement>('.terminal')
  if (terminal && !signal.aborted) {
    try {
      const { mountTerminal } = await import('./terminal')
      if (!signal.aborted) mountTerminal(terminal, signal, site)
    } catch (error) {
      console.error(error)
    }
  }
  page.querySelector('main')?.setAttribute('data-laid-out', '')
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
