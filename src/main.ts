// fontsource's weight-axis-only builds (fonts with an optical-size axis are measured differently
// by canvas (pretext) and the page in some browsers (Firefox), so text overflowed its layout), each
// split into what the site shows and the rest of its set: see scripts/fonts.ts.
import './styles/fonts.css'
import './styles/main.css'
import site from 'virtual:content'
import type { Site } from './content/types'
import { fontsReady } from './layout/fonts'
import { renderPage, setThemeColors } from './render/document'
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
  // The fonts load while the visitor's edition is worked out: the terminal's monospace if that's
  // where this is going (the terminal itself, or a front page that may switch to it), else the paper's.
  const terminal = page.classList.contains('page--terminal') || root.classList.contains('pt-view')
  void fontsReady(terminal ? 'mono' : 'paper')
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
  setThemeColors(next.kind)
  return page
}
