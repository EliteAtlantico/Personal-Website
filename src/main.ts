// Weight-axis-only builds: fonts with an optical-size axis are measured differently by
// canvas (pretext) and the page in some browsers (Firefox), so text overflowed its layout.
import '@fontsource-variable/fraunces/wght.css'
import '@fontsource-variable/newsreader/wght.css'
import '@fontsource-variable/newsreader/wght-italic.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './styles/main.css'
import site from 'virtual:content'
import { startRouter } from './router'

// The dev server also links the stylesheet, for a styled first paint. The imported copy
// (which hot-reloads) is in place by now, so drop the link before its rules go stale.
if (import.meta.env.DEV) document.querySelector('link[data-dev-css]')?.remove()

// The page arrives fully rendered (prerendered in production, rendered by the
// dev server in development). The router enhances it with pretext layout and
// takes over navigation.
const page = document.querySelector<HTMLElement>('#app > .page')
if (page) startRouter(site, page)
else document.documentElement.classList.remove('pt-pending')
