// The terminal view (/terminal). The page arrives with a static transcript;
// this swaps it for a working shell: a prompt, history (Up/Down), Tab
// completion, output you can click, and a reader that shows a story full
// screen (like `less`) until you close it. The lead story rains down its
// pane (rain.ts), and cmatrix rains the whole site full screen. The session
// (history, current folder, everything on screen) outlives the page, so
// switching views and coming back finds the terminal as you left it.
import type { Item, Site } from '../content/types'
import { navigate } from '../router'
import { calm, choose, edition, forget, seen } from '../signals'
import { bodyLines } from './body'
import { createShell, plainText, type Env, type Shell } from './commands'
import { barDate, HOST, USER } from './fs'
import { linesHtml, segmentHtml } from './html'
import { seg, type Line } from './output'
import { startRain, type Rain } from './rain'

/** What survives leaving the page: the shell (history, folder), the screen's contents, and the site it reads. */
let session: { shell: Shell; output: HTMLElement; site: Site } | null = null
/** The terminal on the page right now, for the shell's Env to reach. */
let mounted: { output: HTMLElement; columns(): number; read(title: string, lines: Line[]): void; matrix(): void } | null = null

const env: Env = {
  // `view paper` is a choice worth remembering, like the view links.
  navigate: (path) => {
    void choose({ view: path === '/terminal' ? 'terminal' : 'paper' })
    navigate(path)
  },
  read: (title, lines) => mounted?.read(title, lines),
  matrix: () => mounted?.matrix(),
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
  visitor: () => {
    const current = edition()
    return current && { ...current, signals: seen() }
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
  /**
   * After a command: new output taller than the screen is shown from its first
   * line (like a pager would), shorter output keeps the prompt in view, and a
   * cleared screen starts again from the top.
   */
  const reveal = (first: Element | null) => {
    if (!first || !output.contains(first)) {
      screen.scrollTop = 0
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
    rain?.stop()
    rain = null
    const item = host && site.items.find((i) => i.slug === host.dataset.story)
    if (!host || !item) return
    rain = { host, ...startRain(host, storyText(item), { still: calm() }) }
    if (overlay) rain.pause(true)
  }

  // --- Overlays, full screen over the terminal until q / Esc / back: the reader (a story, like less) and cmatrix ---
  let overlay: HTMLElement | null = null
  let stopOverlay = () => {}
  /** Shows an overlay (instead of any other), holding the dashboard's rain still underneath. */
  const cover = (el: HTMLElement, stop = () => {}) => {
    stopOverlay()
    overlay?.remove()
    overlay = el
    stopOverlay = stop
    section.append(el)
    rain?.pause(true)
  }
  const closeOverlay = () => {
    stopOverlay()
    stopOverlay = () => {}
    overlay?.remove()
    overlay = null
    rain?.pause(false)
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
  mounted = { output, columns: () => Math.max(20, Math.floor(output.clientWidth / charWidth(output))), read, matrix }
  signal.addEventListener('abort', () => {
    if (mounted?.output === output) mounted = null
    rain?.stop()
    stopOverlay()
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
    // A story opened in the reader (or cmatrix): leave the screen where it was, to come back to.
    if (!overlay) reveal(first)
  }

  if (welcome) print(shell.welcome())
  updatePrompt()
  rainOn()
  if (welcome) screen.scrollTop = 0
  else scrollDown()

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
      if (!overlay && fine) focusPrompt()
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
    if (overlay) return closeOverlay()
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
      if (overlay) {
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
  if (fine) focusPrompt()
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
