// The terminal view's page (/terminal). It isn't the newspaper with a terminal
// in it: the whole screen is the terminal, with a status bar across the top
// like a Linux desktop's (workspaces for the views, the window's title, links
// and a clock). The shell itself is JavaScript (src/terminal); what's written
// here is the page without it: the dashboard, every story in it a link, so it
// works and reads with JavaScript off (and for search engines).
import type { Site } from '../content/types'
import { dashboard } from '../terminal/dashboard'
import { barDate, HOST, USER } from '../terminal/fs'
import { linesHtml } from '../terminal/html'
import { line, seg } from '../terminal/output'
import { VIEWS } from './chrome'
import { esc } from './html'

export function renderTerminal(site: Site) {
  // Without JavaScript the dashboard's stories link to their pages; with it, the shell takes over.
  const prompt = (command: string) => line(seg(`${USER}@${HOST}`, 'accent'), seg(':', 'dim'), seg('~', 'green'), seg('$ ', 'dim'), command)
  const transcript = [prompt('dashboard'), ...dashboard(site, { live: false }), prompt('')]

  const workspaces = VIEWS.map((v, i) => `<a href="${v.href}" data-view="${v.name}"${v.name === 'terminal' ? ' aria-current="page"' : ''}>${i + 1} ${v.label.toLowerCase()}</a>`).join('')
  const links = site.config.links
    .map((link) => `<a href="${esc(link.url)}"${link.url.startsWith('http') ? ' rel="noopener"' : ''}>${esc(link.label.toLowerCase())}</a>`)
    .join('')
  const today = barDate(new Date(site.builtAt), 'America/Toronto')

  return `<a class="skip" href="#main">Skip to the terminal</a>
<header class="tty__bar">
  <a class="tty__logo" href="/" aria-label="${esc(site.config.author)}, front page">KC</a>
  <nav class="tty__views" aria-label="Views">${workspaces}</nav>
  <span class="tty__title terminal__title">${USER}@${HOST}: ~</span>
  <nav class="tty__links" aria-label="Elsewhere">${links}</nav>
  <time class="tty__clock">${esc(today)}</time>
</header>
<main id="main" class="terminal" aria-label="Terminal">
  <h1 class="sr-only">${esc(site.config.author)}, as a terminal</h1>
  <div class="terminal__screen">
    <div class="terminal__output">${linesHtml(transcript)}</div>
    <noscript><p class="terminal__note">This shell needs JavaScript to take commands. Every story above is a link.</p></noscript>
  </div>
</main>`
}
