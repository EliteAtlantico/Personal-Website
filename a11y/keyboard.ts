// The keyboard alone, in every view. Tab reaches everything there is to use,
// in order, never gets stuck, and always shows where it is, never under
// something else. Each view's own keys work: the skip link, Enter into a
// story and Esc back out, the signals dialog, the bio stamp's arrows, the
// globe's arrows, the phone edition's section tabs, and the terminal's
// prompt, reader and overlays.
import type { Page } from 'puppeteer-core'
import { launch, openPage, ready, serve, sleep } from '../perf/lib'
import { Checks, type Finding } from '../security/checks'

interface Stop {
  key: string
  /** On screen once it's focused (the browser scrolls it there). */
  visible: boolean
  /** Something shows it has focus: a ring, a shadow, a caret, the globe's caption. */
  indicated: boolean
  /** What covers it, if anything does. */
  covered: string
}

/** Installed in every page: one way to name an element, so the walk and the list of controls agree. */
const HELPERS = () => {
  const w = window as unknown as Record<string, unknown>
  const name = (el: Element) => (el.getAttribute('aria-label') || el.textContent || (el as HTMLInputElement).placeholder || '').replace(/\s+/g, ' ').trim().slice(0, 48)
  // Links by where they go (their text can be re-laid out by pretext); anything else by what it is and says.
  w.__describe = (el: Element) =>
    el instanceof HTMLAnchorElement && el.getAttribute('href')
      ? `a${typeof el.className === 'string' && el.className ? `.${el.className.split(' ')[0]}` : ''}[href="${el.getAttribute('href')}"]`
      : `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${typeof el.className === 'string' && el.className ? `.${el.className.split(' ')[0]}` : ''} "${name(el)}"`
  w.__here = () => {
    const el = document.activeElement as HTMLElement | null
    if (!el || el === document.body) return null
    const describe = w.__describe as (el: Element) => string
    // The globe's stories are read out, not drawn: focus shows as the globe turning to the dot, and its caption.
    const globe = el.closest<HTMLElement>('.globe.is-live')
    const box = (globe?.querySelector('canvas') ?? el).getBoundingClientRect()
    const visible = box.width > 1 && box.height > 1 && box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth
    const style = getComputedStyle(el)
    const ring = (s: CSSStyleDeclaration) => (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none'
    const caret = /^(INPUT|TEXTAREA)$/.test(el.tagName) && style.caretColor !== 'transparent'
    const caption = !!globe && !!globe.querySelector('.globe__caption')?.textContent?.includes(name(el).split(',')[0]!)
    const indicated = ring(style) || ring(getComputedStyle(el, '::after')) || ring(getComputedStyle(el, '::before')) || caret || caption
    let covered = ''
    if (!globe) {
      const x = Math.min(innerWidth - 1, Math.max(0, box.left + box.width / 2))
      const y = Math.min(innerHeight - 1, Math.max(0, box.top + Math.min(box.height / 2, 8)))
      const hit = document.elementFromPoint(x, y)
      if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) covered = describe(hit)
    }
    return { key: describe(el), visible, indicated, covered }
  }
  // What should be reachable by Tab: anything that can be used, shown, and not taken out of the order on purpose.
  w.__controls = () =>
    [...document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, summary, [tabindex]')]
      .filter((el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && !el.closest('[inert], [hidden], dialog:not([open])') && el.getClientRects().length > 0)
      .map((el) => (w.__describe as (el: Element) => string)(el))
}

const here = (page: Page) => page.evaluate(() => (window as unknown as { __here: () => Stop | null }).__here())
const active = (page: Page) => page.evaluate(() => (document.activeElement ? (window as unknown as { __describe: (el: Element) => string }).__describe(document.activeElement) : ''))

/** Puts the keyboard at the top of the page, as a fresh visit does (wherever focus was, even on the terminal's prompt). */
async function fromTheTop(page: Page) {
  await page.evaluate(() => {
    const mark = document.createElement('span')
    mark.tabIndex = -1
    document.body.prepend(mark)
    mark.focus()
    mark.remove()
  })
}

/** Presses Tab from the top until focus comes back round (or `max` presses), noting every stop. */
async function walk(page: Page, max = 160) {
  await page.evaluate(() => {
    window.scrollTo(0, 0)
  })
  await fromTheTop(page)
  const stops: Stop[] = []
  let stuck = ''
  let wrapped = false
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab')
    await sleep(30)
    const stop = await here(page)
    if (!stop) continue
    if (stops.length && stop.key === stops[0]!.key) {
      wrapped = true
      break
    }
    if (stops.length >= 2 && stop.key === stops.at(-1)!.key && stop.key === stops.at(-2)!.key) {
      stuck = stop.key
      break
    }
    stops.push(stop)
  }
  return { stops, stuck, wrapped }
}

export async function checkKeyboard(): Promise<Finding[]> {
  const checks = new Checks('Keyboard')
  const server = await serve()
  const browser = await launch()
  const open = async (path: string, device: 'desktop' | 'mobile' = 'desktop') => {
    const opened = await openPage(browser, device)
    await opened.page.evaluateOnNewDocument(HELPERS)
    await opened.page.evaluateOnNewDocument(() => localStorage.setItem('kc:prefs', JSON.stringify({ view: 'paper' })))
    await opened.page.goto(server.url + path, { waitUntil: 'load' })
    await ready(opened.page)
    await sleep(300)
    return opened
  }
  const until = async (page: Page, test: () => boolean | Promise<boolean>, timeout = 5000) => {
    for (const end = Date.now() + timeout; Date.now() < end; await sleep(50)) if (await test()) return true
    return false
  }

  try {
    // --- Tab through each view ---
    for (const [view, path, device] of [
      ['the front page', '/', 'desktop'],
      ['the phone edition', '/', 'mobile'],
      ['a story', '/research/brain-freeze', 'desktop'],
      ['the terminal', '/terminal', 'desktop'],
    ] as const) {
      const { page, close } = await open(path, device)
      try {
        const { stops, stuck, wrapped } = await walk(page)
        // Listed after the walk: the globe's stories become one Tab stop when it comes to life, which the walk can set off.
        const controls = (await page.evaluate(() => (window as unknown as { __controls: () => string[] }).__controls())) as string[]
        const seen = new Set(stops.map((s) => s.key))
        checks.expect(`Tab never gets stuck (${view})`, !stuck && wrapped, 'high', stuck ? `focus stays on ${stuck}` : `didn't come back round in ${stops.length} presses`)
        checks.expect(`the first Tab is the skip link (${view})`, /^a\.skip\[/.test(stops[0]?.key ?? ''), 'medium', stops[0]?.key)
        const missed = [...new Set(controls.filter((c) => !seen.has(c)))]
        checks.expect(`Tab reaches everything there is to use (${view}, ${stops.length} stops)`, !missed.length, 'medium', `never reached: ${missed.slice(0, 6).join(', ')}`)
        const unseen = stops.filter((s) => !s.visible).map((s) => s.key)
        checks.expect(`focus is always on screen (${view})`, !unseen.length, 'medium', unseen.slice(0, 6).join(', '))
        const unmarked = stops.filter((s) => !s.indicated).map((s) => s.key)
        checks.expect(`focus always shows (${view})`, !unmarked.length, 'medium', unmarked.slice(0, 6).join(', '))
        const hidden = stops.filter((s) => s.covered).map((s) => `${s.key} under ${s.covered}`)
        checks.expect(`focus is never hidden under something else (${view})`, !hidden.length, 'medium', hidden.slice(0, 4).join(' | '))

        // The skip link: from a fresh page, Tab, Enter, and the next Tab is in the content.
        await page.reload({ waitUntil: 'load' })
        await ready(page)
        await fromTheTop(page)
        await page.keyboard.press('Tab')
        const skip = await active(page)
        await page.keyboard.press('Enter')
        await sleep(200)
        await page.keyboard.press('Tab')
        const landed = await page.evaluate(() => !!document.activeElement?.closest('#main'))
        checks.expect(`the skip link takes the keyboard to the content (${view})`, /^a\.skip\[/.test(skip) && landed, 'medium', `${skip}, then ${await active(page)}`)
      } finally {
        await close()
      }
    }

    // --- Front page: into a story with Enter, back out with Esc, to the same story ---
    {
      const { page, close } = await open('/')
      try {
        await page.focus('.page--front .tile__link')
        const lead = await active(page)
        await page.keyboard.press('Enter')
        // Opened, and the transition over (the old page gone).
        const opened = await until(page, () => page.evaluate(() => location.pathname !== '/' && document.querySelectorAll('#app > .page').length === 1 && !!document.querySelector('.page--article')))
        await sleep(200)
        const onStory = await page.evaluate(() => !!document.activeElement?.closest('.page--article') && document.activeElement !== document.body)
        checks.expect('Enter on a story opens it, with focus in the story', opened && onStory, 'medium', await active(page))
        await page.keyboard.press('Escape')
        const back = await until(page, () => page.evaluate(() => location.pathname === '/' && document.querySelectorAll('#app > .page').length === 1 && !!document.querySelector('.page--front')))
        await sleep(200)
        checks.expect('Esc goes back to the front page, focus on the story it came from', back && (await active(page)) === lead, 'medium', `${back ? 'back' : 'not back'}, focus on ${await active(page)}`)

        // --- The signals dialog: focus goes in, stays in, and comes back out to the button ---
        const button = await page.$('[data-note="panel"]')
        if (button) {
          await button.focus()
          await button.dispose()
          await page.keyboard.press('Enter')
          const shown = await until(page, () => page.evaluate(() => !!document.querySelector('dialog.signals[open]')))
          // Past its last control, focus may go out to the browser's own toolbar (the page's body here), never to the page behind.
          const inside = async () => page.evaluate(() => !!document.activeElement?.closest('dialog.signals[open]') || document.activeElement === document.body)
          let stayed = shown && (await page.evaluate(() => !!document.activeElement?.closest('dialog.signals[open]')))
          for (let i = 0; i < 25 && stayed; i++) {
            await page.keyboard.press('Tab')
            stayed = await inside()
          }
          checks.expect('the signals dialog takes focus, and Tab never reaches the page behind it', stayed, 'medium', await active(page))
          await page.keyboard.press('Escape')
          await sleep(300)
          const closedBack = await page.evaluate(() => !document.querySelector('dialog.signals[open]') && document.activeElement?.getAttribute('data-note') === 'panel')
          checks.expect('Esc closes the signals dialog, and focus returns to its button', closedBack, 'medium', await active(page))
        }

        // --- The bio stamp moves with the arrow keys ---
        if (await page.$('.bio__die')) {
          await page.focus('.bio__die')
          const where = () => page.$eval('.bio__die', (el) => `${(el as HTMLElement).style.translate}|${(el as HTMLElement).style.transform}`)
          const before = await where()
          for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight')
          await sleep(200)
          checks.expect('the bio stamp moves with the arrow keys', (await where()) !== before, 'low', before)
        }

        // --- The globe's stories: one Tab stop, the arrow keys go from story to story ---
        await page.$eval('.page--front [data-globe]', (el) => el.scrollIntoView({ block: 'center' }))
        const live = await until(page, () => page.evaluate(() => !!document.querySelector('.page--front .globe.is-live')), 15_000)
        if (live) {
          const stops = await page.$$eval('.page--front .globe__stories [data-slug]', (els) => els.map((el) => (el as HTMLElement).tabIndex))
          checks.expect("the globe's stories are one Tab stop", stops.filter((t) => t === 0).length === 1, 'low', `${stops.filter((t) => t === 0).length} of ${stops.length} in the Tab order`)
          await page.focus('.page--front .globe__stories [tabindex="0"]')
          const first = await active(page)
          await page.keyboard.press('ArrowDown')
          await sleep(150)
          const second = await active(page)
          const title = await page.evaluate(() => document.activeElement?.firstChild?.textContent?.trim() ?? '')
          const caption = await page.$eval('.page--front .globe__caption', (el) => el.textContent ?? '')
          checks.expect('the arrow keys go from story to story, and the caption follows', second !== first && !!title && caption.startsWith(title), 'low', `${first} to ${second}; caption "${caption}"`)
          await page.keyboard.press('Tab')
          await sleep(100)
          checks.expect('Tab leaves the globe after one stop', !(await page.evaluate(() => !!document.activeElement?.closest('.globe__stories'))), 'low', await active(page))
        } else {
          checks.expect('the globe came to life to be tested', false, 'info')
        }
      } finally {
        await close()
      }
    }

    // --- The phone edition's section tabs: one Tab stop; the arrow keys choose a tab and show its panel; Tab goes on into it ---
    {
      const { page, close } = await open('/', 'mobile')
      try {
        const stops = await page.$$eval('.tabs__tab', (tabs) => tabs.filter((tab) => (tab as HTMLElement).tabIndex === 0).length)
        await page.focus('.tabs__tab[aria-selected="true"]')
        await page.keyboard.press('ArrowRight')
        await sleep(700)
        const chosen = await page.evaluate(() => {
          const tab = document.activeElement as HTMLElement
          const panel = document.getElementById(tab.getAttribute('aria-controls') ?? '')
          const pager = document.querySelector('.pager')?.getBoundingClientRect()
          return { tab: tab.textContent, selected: tab.getAttribute('aria-selected') === 'true', shown: !!panel && !!pager && !panel.inert && Math.abs(panel.getBoundingClientRect().left - pager.left) < 2 }
        })
        checks.expect('on a phone, the section tabs are one Tab stop, and the arrow keys choose a tab and show its panel', stops === 1 && chosen.selected && chosen.shown, 'medium', `${stops} Tab stop(s); ${JSON.stringify(chosen)}`)
        await page.keyboard.press('Tab')
        const into = await page.evaluate(() => !!document.activeElement?.closest(`#${document.querySelector('.tabs__tab[aria-selected="true"]')?.getAttribute('aria-controls')}`))
        checks.expect('Tab goes on from the chosen tab into its panel', into, 'medium', await active(page))
      } finally {
        await close()
      }
    }

    // --- The terminal: the prompt, and the overlays ---
    {
      const { page, close } = await open('/terminal')
      try {
        const input = () => page.evaluate(() => document.activeElement?.id === 'terminal-input')
        checks.expect('the terminal starts with focus in the prompt', await input(), 'low', await active(page))
        await page.type('#terminal-input', 'he')
        await page.keyboard.press('Tab')
        const completed = await page.$eval('#terminal-input', (el) => (el as HTMLInputElement).value)
        checks.expect("Tab completes what's typed at the prompt", completed.startsWith('help') && (await input()), 'low', `"${completed}"`)
        await page.$eval('#terminal-input', (el) => ((el as HTMLInputElement).value = ''))
        await page.keyboard.press('Tab')
        const left = !(await input())
        await page.keyboard.down('Shift')
        await page.keyboard.press('Tab')
        await page.keyboard.up('Shift')
        checks.expect('on an empty prompt, Tab moves on and Shift+Tab comes back', left && (await input()), 'high', await active(page))

        for (const [what, command, overlay] of [
          ['the reader', 'open research/brain-freeze.md', '.terminal__reader'],
          ['the globe', 'globe', '.terminal__globe'],
          ['cmatrix', 'cmatrix', '.terminal__matrix'],
        ] as const) {
          await page.focus('#terminal-input')
          await page.keyboard.type(command)
          await page.keyboard.press('Enter')
          const shown = await until(page, () => page.evaluate((sel) => !!document.querySelector(sel), overlay))
          await sleep(300)
          // Tab may go on to the status bar, or out to the browser, but never to what the overlay covers.
          const underneath = async () => page.evaluate(() => !!document.activeElement?.closest('.terminal__screen'))
          let stays = shown && (await page.evaluate((sel) => !!document.activeElement?.closest(sel), overlay))
          for (let i = 0; i < 12 && stays; i++) {
            await page.keyboard.press('Tab')
            stays = !(await underneath())
          }
          checks.expect(`${what} takes focus, and Tab never reaches what it covers`, stays, 'medium', `${shown ? 'shown' : 'never shown'}; focus on ${await active(page)}`)
          await page.focus(overlay).catch(() => undefined)
          await page.keyboard.press('Escape')
          await sleep(300)
          const closed = await page.evaluate((sel) => !document.querySelector(sel), overlay)
          checks.expect(`Esc closes ${what}, and focus goes back to the prompt`, closed && (await input()), 'medium', `${closed ? 'closed' : 'still open'}; focus on ${await active(page)}`)
        }
      } finally {
        await close()
      }
    }
  } finally {
    await browser.close()
    server.close()
  }
  return checks.findings
}
