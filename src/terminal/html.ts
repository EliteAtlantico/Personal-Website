// Output lines as HTML, for both the live terminal and the static /terminal
// page. Every piece of text is escaped; clickable pieces become buttons (run a
// command, or fill the prompt) or real links.
import { GLOBE_HINT } from '../render/globe'
import type { Line, Pane, Row, Segment } from './output'

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** Only links that go somewhere expected: this site, the web, or email. */
const safe = (href: string) => /^(https?:|mailto:|\/)/.test(href)

export function segmentHtml(s: Segment): string {
  const style = s.style ? ` t-${s.style}` : ''
  const text = escape(s.text)
  if (s.href && safe(s.href)) {
    const away = /^https?:/.test(s.href) ? ' target="_blank" rel="noopener"' : ''
    return `<a class="t-link${style}" href="${escape(s.href)}"${away}>${text}</a>`
  }
  if (s.run) return `<button type="button" class="t-run${style}" data-run="${escape(s.run)}">${text}</button>`
  if (s.fill) return `<button type="button" class="t-run${style}" data-fill="${escape(s.fill)}">${text}</button>`
  return style ? `<span class="${style.trim()}">${text}</span>` : text
}

function rowHtml(row: Row): string {
  // One line per story: a long title ends in an ellipsis, and shows in full on hover.
  const inner = `<span class="t-row__label" title="${escape(row.label)}">${escape(row.label)}</span>${row.detail ? `<span class="t-row__detail">${escape(row.detail)}</span>` : ''}`
  if (row.href && safe(row.href)) return `<li><a class="t-row" href="${escape(row.href)}">${inner}</a></li>`
  if (row.run) return `<li><button type="button" class="t-row" data-run="${escape(row.run)}">${inner}</button></li>`
  return `<li class="t-row">${inner}</li>`
}

function paneHtml(pane: Pane): string {
  const note = pane.note ? `<span class="t-pane__note">${escape(pane.note)}</span>` : ''
  const rows = pane.rows?.length ? `<ul class="t-rows">${pane.rows.map(rowHtml).join('')}</ul>` : ''
  const links = pane.links?.length ? `<p class="t-pane__links">${pane.links.map(segmentHtml).join('')}</p>` : ''
  const rain = pane.rain ? `<div class="t-rain" data-story="${escape(pane.rain)}" aria-hidden="true"></div>` : ''
  const body = pane.globe
    ? `<div class="globe" data-globe><div class="globe__summary">${linesHtml(pane.lines ?? [])}</div><p class="globe__caption" aria-hidden="true">${escape(GLOBE_HINT)}</p></div>`
    : linesHtml(pane.lines ?? [])
  return `<section class="t-pane${pane.area ? ` t-pane--${pane.area}` : ''}"><h2 class="t-pane__title">${escape(pane.title)}</h2>${note}${body}${rows}${links}${rain}</section>`
}

/** The dashboard: the lead and the column beside it on top, the desks in a grid below. */
function dashboardHtml(panes: Pane[]): string {
  const top = panes.filter((p) => p.area).map(paneHtml).join('')
  const desks = panes.filter((p) => !p.area).map(paneHtml).join('')
  return `<div class="t-dash"><div class="t-dash__top">${top}</div><div class="t-dash__desks">${desks}</div></div>`
}

export function lineHtml(line: Line): string {
  if (line.panes) return dashboardHtml(line.panes)
  const vars = [
    line.hang ? `--hang:${line.hang}ch` : '',
    line.grid ? `--cell:${Math.max(0, ...line.segments.map((s) => s.text.length))}ch` : '',
    line.clamp ? `--clamp:${line.clamp}` : '',
  ].filter(Boolean)
  const body = line.grid ? line.segments.map((s) => `<span>${segmentHtml(s)}</span>`).join('') : line.segments.map(segmentHtml).join('')
  return `<div class="t-line${line.grid ? ' t-grid' : ''}${line.clamp ? ' t-clamp' : ''}"${vars.length ? ` style="${vars.join(';')}"` : ''}>${body}</div>`
}

export const linesHtml = (lines: Line[]) => lines.map(lineHtml).join('')
