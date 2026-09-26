// The terminal view (/terminal). The page arrives with a static transcript;
// this swaps it for a working shell: a prompt, history (Up/Down), Tab
// completion, output you can click, and a reader that shows a story full
// screen (like `less`) until you close it. The lead story rains down its
// pane (rain.ts), and cmatrix rains the whole site full screen. The session
// (history, current folder, everything on screen) outlives the page, so
// switching views and coming back finds the terminal as you left it. The
// dashboard's map pane holds the globe of where the stories happened
// (src/globe), and `globe` opens it full screen.
import type { Item, Site } from '../content/types'
import { sturdy } from '../enhance'
import type { Globe } from '../globe'
import { frontOrder } from '../globe/places'
import { fontsReady } from '../layout/fonts'
import { GLOBE_HINT, globeSummary } from '../render/globe'
import { navigate } from '../router'
import { calm, choose, edition, forget, seen } from '../signals'
import { bodyLines } from './body'
import { createShell, plainText, type Env, type Shell } from './commands'
import { storyPath } from './dashboard'
import { barDate, HOST, USER } from './fs'
import { linesHtml, segmentHtml } from './html'
import { seg, type Line } from './output'
import { keepAsPicture } from '../ui/picture'
import { startRain, type Rain } from './rain'

/** What survives leaving the page: the shell (history, folder), the screen's contents, and the site it reads. */
let session: { shell: Shell; output: HTMLElement; site: Site } | null = null
/** The terminal on the page right now, for the shell's Env to reach. */
let mounted: { output: HTMLElement; columns(): number; read(title: string, lines: Line[]): void; matrix(): void; globe(): void } | null = null

const env: Env = {
  // `view paper` is a choice worth remembering, like the view links (the globe never opens by itself).
  navigate: (path) => {
    if (path === '/') void choose({ view: 'paper' })
    navigate(path)
  },
  read: (title, lines) => mounted?.read(title, lines),
  matrix: () => mounted?.matrix(),
  globe: () => mounted?.globe(),
  openUrl: (url) => {
    if (url.startsWith('mailto:')) location.href = url
    else window.open(url, '_blank', 'noopener')
  },
  clear: () => mounted?.output.replaceChildren(),
  forget: () => {
    session?.shell.clearHistory()
    mounted?.output.replaceChildren()
    void forget()
  },
  body: (item) => bodyLines(item.bodyHtml),
  now: () => new Date(),
  columns: () => mounted?.columns() ?? 80,
  site: () => edition()?.site ?? session!.site,
  visitor: (full) => {
    const current = edition()
    return current && { ...current, signals: full ? seen() : current.signals }
  },
  personalize: (on) => void choose({ personalize: on }),
}

/** Old lines scroll away past this many. */
const MAX_LINES = 2000

/** What rains: a story's headline, blurb and body, as one run of text. */
const storyText = (item: Item) => [item.headline ?? item.title, item.blurb, plainText(item.bodyHtml)].join(' ')
/** Every story on the site, for cmatrix. */
const siteText = (site: Site) => site.items.map(storyText).join(' ')

/** `site` is the visitor's edition of it (src/signals). */
export function mountTerminal(section: HTMLElement, signal: AbortSignal, site: Site) {
  const screen = section.querySelector<HTMLElement>('.terminal__screen')
  // The status bar: the window's title follows the current folder, and the clock ticks.
  const page = section.closest('.page') ?? document
  const title = page.querySelector<HTMLElement>('.terminal__title')
  const clock = page.querySelector<HTMLTimeElement>('.tty__clock')
  if (!screen) return
  if (clock) {
    const tick = () => {
      const now = new Date()
      clock.textContent = `${barDate(now)}  ${now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
      clock.dateTime = now.toISOString()
    }
    tick()
    const timer = setInterval(tick, 15_000)
    signal.addEventListener('abort', () => clearInterval(timer))
  }

  const welcome = !session
  session ??= { shell: createShell(site, env), output: newOutput(), site }
  const { shell, output } = session

  // Swap the page's static transcript for the live one, and add the prompt.
  screen.querySelector('.terminal__output')?.remove()
  screen.prepend(output)
  const form = document.createElement('form')
  form.className = 'terminal__prompt'
  const label = document.createElement('label')
  label.htmlFor = 'terminal-input'
  const input = document.createElement('input')
  Object.assign(input, { id: 'terminal-input', type: 'text', autocomplete: 'off', spellcheck: false })
  for (const [name, value] of Object.entries({ autocapitalize: 'off', autocorrect: 'off', enterkeyhint: 'go', 'aria-label': 'Command' })) input.setAttribute(name, value)
  form.append(label, input)
  screen.append(form)
  section.classList.add('is-live')
  const fine = matchMedia('(pointer: fine)').matches
  const focusPrompt = () => input.focus({ preventScroll: true })

  const updatePrompt = () => {
    label.innerHTML = shell.echo('').segments.map(segmentHtml).join('').trimEnd()
    if (title) title.textContent = `${USER}@${HOST}: ${shell.cwd()}`
  }
  const print = (lines: Line[]) => {
    output.insertAdjacentHTML('beforeend', linesHtml(lines))
    while (output.childElementCount > MAX_LINES) output.firstElementChild!.remove()
  }
  const scrollDown = () => {
    screen.scrollTop = screen.scrollHeight
  }
  /** Down to the prompt, now and once more after this frame's layout (the rain and the globe settle their sizes). */
  const promptAtBottom = () => {
    scrollDown()
    requestAnimationFrame(scrollDown)
  }
  /**
   * After a command: new output taller than the screen is shown from its first
   * line (like a pager would), shorter output keeps the prompt in view, and a
   * cleared screen starts again from the top. A dashboard is the exception:
   * like a real terminal's, it scrolls up out of the way, the prompt at the
   * bottom of the screen.
   */
  const reveal = (first: Element | null) => {
    if (!first || !output.contains(first)) {
      screen.scrollTop = 0
      return
    }
    const boards = output.querySelectorAll('.t-dash')
    const board = boards[boards.length - 1]
    if (board && first.compareDocumentPosition(board) & Node.DOCUMENT_POSITION_FOLLOWING) {
      promptAtBottom()
      return
    }
    const top = first.getBoundingClientRect().top
    if (screen.getBoundingClientRect().bottom < top || output.getBoundingClientRect().bottom - top > screen.clientHeight) {
      screen.scrollTop += top - screen.getBoundingClientRect().top - 12
    } else scrollDown()
  }

  // The newest dashboard's lead pane rains; older ones up the scrollback keep their last frame.
  let rain: (Rain & { host: HTMLElement }) | null = null
  const rainOn = () => {
    const hosts = output.querySelectorAll<HTMLElement>('.t-rain')
    const host = hosts[hosts.length - 1]
    if (host && rain?.host === host) return
    // The dashboard it rained on stays up the scrollback, as a picture of its last frame.
    rain?.stop(true)
    rain = null
    const item = host && site.items.find((i) => i.slug === host.dataset.story)
    if (!host || !item) return
    rain = { host, ...startRain(host, storyText(item), { still: calm() }) }
    if (covered()) rain.pause(true)
  }

  // The newest dashboard's map pane has a live globe; older ones up the scrollback keep a picture of theirs.
  // It starts as its pane comes near the screen: on a phone the dashboard is one long column.
  let map: { host: HTMLElement; globe: Globe | null; near: IntersectionObserver } | null = null
  const mapOn = () => {
    const hosts = output.querySelectorAll<HTMLElement>('.t-pane [data-globe]')
    const host = hosts[hosts.length - 1]
    if (host && map?.host === host) return
    map?.near.disconnect()
    map?.globe?.dispose((canvas, done) => keepAsPicture(canvas, 'globe__picture', done))
    map = null
    if (!host || !sturdy()) return
    const near = new IntersectionObserver(
      ([seen]) => {
        if (!seen?.isIntersecting) return
        near.disconnect()
        void globeModule().then((module) => {
          if (!module || map !== entry || signal.aborted) return
          entry.globe = module.mountGlobe(host, { site, mode: 'embed', open: (item) => execute(`open ${storyPath(item)}`) })
          if (covered()) entry.globe?.pause(true)
        })
      },
      { rootMargin: '300px 0px' },
    )
    const entry: { host: HTMLElement; globe: Globe | null; near: IntersectionObserver } = { host, globe: null, near }
    map = entry
    near.observe(host)
    signal.addEventListener('abort', () => near.disconnect())
  }

  // --- Overlays, full screen over the terminal until q / Esc / back: the reader (a story, like less), cmatrix and the globe.
  // They stack: a story opened from the globe opens over it, and closing the story goes back to the globe.
  const overlays: Array<{ el: HTMLElement; stop: () => void }> = []
  const covered = () => overlays.length > 0
  /** Shows an overlay on top, holding the dashboard's rain and globe still underneath. */
  const cover = (el: HTMLElement, stop = () => {}) => {
    overlays.push({ el, stop })
    section.append(el)
    // What's underneath can't be tabbed to or clicked while it's hidden (the status bar stays usable).
    screen.inert = true
    rain?.pause(true)
    map?.globe?.pause(true)
  }
  const closeOverlay = () => {
    const top = overlays.pop()
    top?.stop()
    top?.el.remove()
    // Its canvases (cmatrix's rain) hand their bitmaps back now, not whenever they're collected.
    for (const canvas of top?.el.querySelectorAll('canvas') ?? []) canvas.width = canvas.height = 0
    const under = overlays.at(-1)
    if (under) {
      under.el.focus({ preventScroll: true })
      return
    }
    screen.inert = false
    rain?.pause(false)
    map?.globe?.pause(false)
    if (fine) focusPrompt()
  }
  const read = (name: string, lines: Line[]) => {
    const reader = document.createElement('div')
    reader.className = 'terminal__reader'
    reader.setAttribute('role', 'dialog')
    reader.setAttribute('aria-label', name)
    reader.innerHTML = `<div class="reader__body" tabindex="0"><div class="reader__text">${linesHtml(lines)}</div></div>
      <div class="reader__bar"><button type="button" class="reader__back" data-close>← back</button><span class="reader__name"></span><span class="reader__pos"></span><span class="reader__keys">q back · ↑↓ space to scroll</span></div>`
    reader.querySelector('.reader__name')!.textContent = name
    cover(reader)
    const body = reader.querySelector<HTMLElement>('.reader__body')!
    const pos = reader.querySelector<HTMLElement>('.reader__pos')!
    const where = () => {
      const max = body.scrollHeight - body.clientHeight
      pos.textContent = max <= 0 ? 'all' : body.scrollTop <= 0 ? 'top' : body.scrollTop >= max - 1 ? 'end' : `${Math.round((body.scrollTop / max) * 100)}%`
    }
    body.addEventListener('scroll', where, { passive: true })
    where()
    // Arrows, space and Page Up/Down scroll the focused reader natively.
    body.focus({ preventScroll: true })
  }
  const matrix = () => {
    const screenful = document.createElement('div')
    screenful.className = 'terminal__matrix'
    screenful.tabIndex = -1
    screenful.setAttribute('role', 'dialog')
    screenful.setAttribute('aria-label', 'cmatrix, digital rain made of the stories')
    screenful.innerHTML = `<div class="t-rain" aria-hidden="true"></div>
      <div class="reader__bar"><button type="button" class="reader__back" data-close>← back</button><span class="reader__name">cmatrix</span><span class="reader__keys">every story on the site · move your mouse through it · q quits</span></div>`
    const falling = startRain(screenful.querySelector<HTMLElement>('.t-rain')!, siteText(site), { full: true, still: calm() })
    cover(screenful, () => falling.stop())
    screenful.focus({ preventScroll: true })
  }
  /** The globe, full screen. Its stories are buttons too (for the keyboard); picking one opens it in the reader, over the globe. */
  const globe = () => {
    const screenful = document.createElement('div')
    screenful.className = 'terminal__globe'
    screenful.tabIndex = -1
    screenful.setAttribute('role', 'dialog')
    screenful.setAttribute('aria-label', 'Globe: where the stories happened')
    const stories = frontOrder(site)
      .map((item) => `<li><button type="button" data-run="open ${escapeHtml(storyPath(item))}" data-slug="${escapeHtml(item.slug)}">${escapeHtml(item.title)}</button></li>`)
      .join('')
    screenful.innerHTML = `<div class="globe" data-globe>
        <p class="globe__summary">${escapeHtml(globeSummary(site))}</p>
        <ul class="globe__stories" aria-label="The stories">${stories}</ul>
        <p class="globe__caption" aria-hidden="true">${escapeHtml(GLOBE_HINT)}</p>
      </div>
      <div class="reader__bar"><button type="button" class="reader__back" data-close>← back</button><span class="reader__name">globe</span><span class="reader__keys">drag to turn · scroll to zoom · tab through the stories · q quits</span></div>`
    const spinning: { globe: Globe | null } = { globe: null }
    cover(screenful, () => spinning.globe?.dispose())
    screenful.focus({ preventScroll: true })
    void globeModule().then((module) => {
      if (!module || !screenful.isConnected) return
      spinning.globe = module.mountGlobe(screenful.querySelector<HTMLElement>('.globe')!, { site, mode: 'full', open: (item) => execute(`open ${storyPath(item)}`) })
    })
  }
  mounted = { output, columns: () => Math.max(20, Math.floor(output.clientWidth / charWidth(output))), read, matrix, globe }
  signal.addEventListener('abort', () => {
    if (mounted?.output === output) mounted = null
    rain?.stop()
    map?.globe?.dispose()
    for (const { stop } of overlays) stop()
    releaseOldPage(section, output)
  })

  // Up/Down walk the history; what was being typed comes back at the end.
  let index = shell.history().length
  let draft = ''
  const execute = (command: string) => {
    print([shell.echo(command)])
    const first = output.lastElementChild
    print(shell.run(command))
    index = shell.history().length
    draft = ''
    updatePrompt()
    rainOn()
    mapOn()
    // A story opened in the reader (or cmatrix, or the globe): leave the screen where it was, to come back to.
    if (!covered()) reveal(first)
  }

  if (welcome) print(shell.welcome())
  updatePrompt()
  rainOn()
  mapOn()
  // The terminal opens like one: the prompt at the bottom of the screen, the dashboard above it
  // (on a phone, where you tap more than type, it starts from the top instead).
  if (welcome && !fine) screen.scrollTop = 0
  else promptAtBottom()

  form.addEventListener(
    'submit',
    (event) => {
      event.preventDefault()
      const command = input.value
      input.value = ''
      execute(command)
    },
    { signal },
  )

  input.addEventListener('input', scrollDown, { signal })
  input.addEventListener(
    'keydown',
    (event) => {
      const history = shell.history()
      if (event.key === 'Tab') {
        // Tab completes what's typed, as in a shell. On an empty line, or with Shift, it moves focus on
        // as it does everywhere else, so the keyboard can always leave the prompt.
        if (event.shiftKey || !input.value.trim()) return
        event.preventDefault()
        const { value, options } = shell.complete(input.value)
        if (value !== input.value) input.value = value
        else if (options.length) {
          // Several choices: list them, like a second Tab in bash.
          print([shell.echo(input.value), { segments: options.map((o) => seg(o, o.endsWith('/') ? 'dir' : 'file')), grid: true }])
          scrollDown()
        }
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        if (event.key === 'ArrowUp' && index > 0) {
          if (index === history.length) draft = input.value
          index--
        } else if (event.key === 'ArrowDown' && index < history.length) index++
        else return
        input.value = index === history.length ? draft : history[index]!
        input.setSelectionRange(input.value.length, input.value.length)
      } else if (event.ctrlKey && event.key === 'l') {
        event.preventDefault()
        output.replaceChildren()
      } else if (event.ctrlKey && event.key === 'u') {
        event.preventDefault()
        input.value = ''
      } else if (event.key === 'Escape') {
        // Esc belongs to the shell here; otherwise the router would take it as "go back".
        event.preventDefault()
        input.value = ''
      }
    },
    { signal },
  )

  // Clicks: output runs the command it stands for (or puts it in the prompt); the reader closes on "back".
  section.addEventListener(
    'click',
    (event) => {
      const target = (event.target as Element).closest<HTMLElement>('[data-run], [data-fill], [data-close]')
      if (!target) return
      event.preventDefault()
      if (target.dataset.close !== undefined) return closeOverlay()
      if (target.dataset.run !== undefined) execute(target.dataset.run)
      else {
        closeOverlay()
        input.value = target.dataset.fill ?? ''
        focusPrompt()
        return
      }
      if (!covered() && fine) focusPrompt()
    },
    { signal },
  )
  // A click anywhere else on the screen (that isn't selecting text) goes to the prompt.
  screen.addEventListener(
    'click',
    (event) => {
      if ((event.target as Element).closest('a, button, input') || String(getSelection() ?? '')) return
      focusPrompt()
    },
    { signal },
  )
  /**
   * Ctrl+C, as in any terminal: it interrupts what's running (the reader or
   * cmatrix closes, leaving the screen as it was), or cancels the line being
   * typed, leaving it in the scrollback with ^C. On an empty line it just
   * moves to a new one.
   */
  const interrupt = () => {
    if (covered()) return closeOverlay()
    print([shell.echo(input.value, [seg('^C', 'dim')])])
    input.value = ''
    index = shell.history().length
    draft = ''
    scrollDown()
    if (fine) focusPrompt()
  }

  // Keys: Ctrl+C interrupts; q or Esc close the reader or cmatrix; typing anywhere else on the page types into the prompt.
  // Caught on the way down (capture), so the reader gets Esc before the router takes it as "go back".
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'c') {
        // ...unless there's a selection to copy (Ctrl+C is copy on Windows and Linux).
        const selecting = String(getSelection() ?? '') !== '' || (document.activeElement === input && input.selectionStart !== input.selectionEnd)
        if (!selecting) {
          event.preventDefault()
          interrupt()
        }
        return
      }
      if (covered()) {
        if (event.key === 'q' || event.key === 'Escape') {
          event.preventDefault()
          closeOverlay()
        }
        return
      }
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return
      if ((event.target as Element).closest?.('input, textarea, select, [contenteditable], a, button')) return
      focusPrompt()
    },
    { signal, capture: true },
  )
  // On a phone, focusing would pop the keyboard up over the dashboard; wait for a tap.
  if (fine) whenShown(() => document.activeElement === document.body && focusPrompt(), signal)
}

/**
 * Runs `then` once the page is showing. A page loaded afresh stays hidden
 * while it's laid out (pt-pending, index.html), and nothing hidden can take
 * focus.
 */
function whenShown(then: () => void, signal: AbortSignal) {
  const root = document.documentElement
  if (!root.classList.contains('pt-pending')) return then()
  const watch = new MutationObserver(() => {
    if (root.classList.contains('pt-pending')) return
    watch.disconnect()
    if (!signal.aborted) then()
  })
  watch.observe(root, { attributes: true, attributeFilter: ['class'] })
  signal.addEventListener('abort', () => watch.disconnect())
}

/**
 * The scrollback outlives the page, but it mustn't keep the page: while it
 * sits in the old page's screen, the whole old page stays in memory with it.
 * Once the router has taken the old page away (after its fade), the
 * scrollback leaves it too, unless it has already moved into a new terminal.
 */
function releaseOldPage(section: HTMLElement, output: HTMLElement) {
  let tries = 0
  const release = () => {
    if (section.isConnected) {
      if (++tries < 20) setTimeout(release, 250)
      return
    }
    if (output.isConnected) return
    output.remove()
    // The newest rain starts again on its canvas when the terminal comes back; until then it needs no bitmap.
    for (const canvas of output.querySelectorAll<HTMLCanvasElement>('.t-rain canvas')) canvas.width = canvas.height = 0
  }
  setTimeout(release, 250)
}

function newOutput() {
  const output = document.createElement('div')
  output.className = 'terminal__output'
  output.setAttribute('role', 'log')
  output.setAttribute('aria-live', 'polite')
  return output
}

/** The width of one character of the terminal's (monospaced) font. */
function charWidth(output: HTMLElement) {
  const probe = document.createElement('span')
  probe.textContent = '0'.repeat(20)
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre'
  output.append(probe)
  const width = probe.getBoundingClientRect().width / 20
  probe.remove()
  return width || 8.4
}

/** The globe's code comes in its own chunk, and needs pretext (and the monospace) for its labels. */
async function globeModule() {
  if (!(await fontsReady('mono'))) return null
  return import('../globe')
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
