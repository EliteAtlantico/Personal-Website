// Weight-axis-only builds: fonts with an optical-size axis are measured differently by
// canvas (pretext) and the page in some browsers (Firefox), so text overflowed its layout.
import '@fontsource-variable/fraunces/wght.css'
import '@fontsource-variable/newsreader/wght.css'
import '@fontsource-variable/newsreader/wght-italic.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './styles/main.css'
import site from 'virtual:content'
import type { Site } from './content/types'
import { fontsReady } from './layout/fonts'
import { renderPage } from './render/document'
import { normalizePath } from './render/paths'
import { startRouter } from './router'
import { openedAsTerminal, personalize } from './signals'

// The dev server also links the stylesheet, for a styled first paint. The imported copy
// (which hot-reloads) is in place by now, so drop the link before its rules go stale.
if (import.meta.env.DEV) document.querySelector('link[data-dev-css]')?.remove()

// The page arrives fully rendered (prerendered in production, rendered by the
// dev server in development), in the order everyone gets. Before it's shown
// (see the inline script in index.html), it's laid out for this visitor
// (src/signals), and then the router enhances it with pretext layout and
// takes over navigation.
void start()

async function start() {
  const root = document.documentElement
  let page = document.querySelector<HTMLElement>('#app > .page')
  if (!page) {
    root.classList.remove('pt-pending', 'pt-view')
    return
  }
  // The fonts load while the visitor's edition is worked out.
  void fontsReady()
  const edition = await personalize(site)
  if (normalizePath(location.pathname) === '/') {
    if (edition.decision.view === 'terminal') {
      // A developer landing on the front page starts in the terminal (or anyone who picked it last time).
      history.replaceState(history.state, '', `/terminal${location.search}`)
      if (!edition.decision.chosen) openedAsTerminal()
      page = replace(page, '/terminal', edition.site)
    } else if (edition.site !== site) {
      page = replace(page, '/', edition.site)
    }
  }
  root.classList.remove('pt-view')
  startRouter(edition.site, page)
}

/** Swaps the prerendered page for the same URL laid out for this visitor (or another view). */
function replace(old: HTMLElement, path: string, edition: Site) {
  const next = renderPage(edition, path)
  const template = document.createElement('template')
  template.innerHTML = next.html
  const page = template.content.firstElementChild as HTMLElement
  old.replaceWith(page)
  document.title = next.title
  return page
}
