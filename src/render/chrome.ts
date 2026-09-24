// The masthead and footer that frame every page.
import type { Site } from '../content/types'
import { esc, formatDate } from './html'
import { coverFigure } from './tiles'

/** The ways to read the site: the paper's switch sits next to the date, the terminal's in its status bar. */
export const VIEWS = [
  { name: 'paper', label: 'Paper', href: '/' },
  { name: 'terminal', label: 'Terminal', href: '/terminal' },
] as const
export type View = (typeof VIEWS)[number]['name']

/** `view` marks which view this page is (none on a story, which every view shares). */
export function masthead(site: Site, variant: 'full' | 'compact', view?: View) {
  const { config } = site
  const links = config.links
    .map((link) => `<a href="${esc(link.url)}"${link.url.startsWith('http') ? ' rel="noopener"' : ''}>${esc(link.label)}</a>`)
    .join('')
  const views = VIEWS.map((v) => `<a href="${v.href}" data-view="${v.name}"${v.name === view ? ' aria-current="page"' : ''}>${v.label}</a>`).join('<span aria-hidden="true">/</span>')
  const strip = `<div class="masthead__strip">
    <span class="masthead__when">
      <span class="masthead__date" data-today>${esc(formatDate(site.builtAt))}</span>
      <nav class="masthead__views" aria-label="Views">${views}</nav>
    </span>
    <span class="masthead__edition">${esc(config.edition)}</span>
    <nav class="masthead__links" aria-label="Elsewhere">${links}</nav>
  </div>`

  if (variant === 'compact') {
    return `<a class="skip" href="#main">Skip to content</a>
<header class="masthead masthead--compact">
  ${strip}
  <p class="masthead__title"><a href="/">${esc(config.author)}</a></p>
</header>`
  }
  // On the front page the name line is the page's <h1>; the banner (when there is one) sits above it.
  return `<a class="skip" href="#main">Skip to content</a>
<header class="masthead masthead--full">
  ${strip}
  ${banner(site)}
  <h1 class="masthead__tagline"><span class="masthead__name">${esc(config.author)}</span> <span aria-hidden="true">·</span> ${esc(config.tagline)}</h1>
</header>`
}

/**
 * The banner strip. Its settings travel as data attributes for the typographic
 * portrait (layout/portrait.ts); without JavaScript the photo is simply cropped
 * to the same slice.
 */
function banner(site: Site) {
  const settings = site.config.banner
  if (!site.banner || !settings) return ''
  const [top, bottom] = settings.band ?? [0, 1]
  const attrs = [
    ` data-band="${top},${bottom}" data-mode="${settings.mode ?? 'tone'}"`,
    settings.landmark
      ? ` data-landmark="${esc(JSON.stringify(settings.landmark.outline))}" data-landmark-label="${esc(settings.landmark.label)}"`
      : '',
    settings.skyline ? ` data-skyline="${esc(settings.skyline)}"` : '',
  ].join('')
  const figure = coverFigure(site.banner, 'masthead__banner', 3, '(max-width: 1280px) 100vw, 1280px')
  return (
    // With the skyline worked out ahead of time, the type is drawn without the photo, which then only
    // loads (lazily) for visitors who see it: no JavaScript, or a browser that can't draw the type.
    // Tone mode reads the photo's pixels, so it needs the photo straight away.
    (settings.skyline ? figure : figure.replace('loading="lazy"', 'loading="eager" fetchpriority="high"')).replace(
      '<figure class="masthead__banner" style="',
      `<figure class="masthead__banner"${attrs} style="--banner-y: ${(((top + bottom) / 2) * 100).toFixed(1)}%; `,
    )
  )
}

export function footer(site: Site) {
  const year = new Date(site.builtAt).getFullYear()
  return `<footer class="colophon">
  <p>© ${year} ${esc(site.config.author)}. Set in Fraunces, Newsreader and IBM Plex Mono.</p>
  <p>No cookies, no trackers. <a href="/resume.pdf">Résumé (PDF)</a></p>
</footer>`
}
