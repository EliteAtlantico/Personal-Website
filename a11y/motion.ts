// Reduced motion: with the operating system asking for it, nothing on the site
// moves by itself. Each view is watched once it's settled: frames drawn,
// animations running, canvases changing, videos playing. So are the things
// that move when used: opening a story (the words' flight), the terminal's
// cmatrix and full-screen globe, the globe turning to a story, and on a phone,
// the text trailing the scroll and the panels gliding between tabs. A run with
// motion allowed first proves the watching can see movement at all.
import type { Page } from 'puppeteer-core'
import { launch, openPage, ready, serve, sleep, terminalCommand } from '../perf/lib'
import { Checks, type Finding } from '../security/checks'

/** Counts animation frames asked for, from before the page's own code runs. */
const COUNT_FRAMES = () => {
  const w = window as unknown as { __frames: number }
  w.__frames = 0
  const request = window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = (callback) =>
    request((time) => {
      w.__frames++
      callback(time)
    })
}

/** What moves on the page over `ms`: frames drawn, animations still running, canvases that changed, videos playing. */
async function watch(page: Page, ms = 2000) {
  const snapshot = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('canvas')]
        .filter((c) => c.width && c.height && c.isConnected)
        .map((c) => {
          try {
            // A cheap fingerprint of what's drawn (WebGL canvases are read from a copy, via drawImage).
            const probe = document.createElement('canvas')
            probe.width = 64
            probe.height = 32
            const ctx = probe.getContext('2d')!
            ctx.drawImage(c, 0, 0, 64, 32)
            let sum = 0
            for (const v of ctx.getImageData(0, 0, 64, 32).data) sum = (sum * 31 + v) >>> 0
            return `${c.className || c.parentElement?.className}:${sum}`
          } catch {
            return `${c.className}:?`
          }
        }),
    )
  const before = await snapshot()
  const frames0 = await page.evaluate(() => (window as unknown as { __frames: number }).__frames)
  await sleep(ms)
  const frames = (await page.evaluate(() => (window as unknown as { __frames: number }).__frames)) - frames0
  const after = await snapshot()
  const changed = after.filter((v) => !before.includes(v)).map((v) => v.split(':')[0]!)
  const running = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === 'running')
      .map((a) => `${(a as CSSAnimation).animationName ?? 'script'} on ${(a.effect as KeyframeEffect | null)?.target?.className ?? '?'}`.slice(0, 80)),
  )
  const playing = await page.evaluate(() => [...document.querySelectorAll('video')].filter((v) => !v.paused).length)
  return { frames, changed, running, playing }
}

type Seen = Awaited<ReturnType<typeof watch>>
const moving = (s: Seen) => s.frames > 6 || s.changed.length > 0 || s.running.length > 0 || s.playing > 0
const describe = (s: Seen) => [`${s.frames} frames in 2 s`, s.changed.length && `changing: ${s.changed.join(', ')}`, s.running.length && `running: ${s.running.join(', ')}`, s.playing && `${s.playing} video(s) playing`].filter(Boolean).join('; ')

export async function checkMotion(): Promise<Finding[]> {
  const checks = new Checks('Reduced motion')
  const server = await serve()
  const browser = await launch()
  const open = async (path: string, reduce: boolean, device: 'desktop' | 'mobile' = 'desktop') => {
    const opened = await openPage(browser, device)
    await opened.page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }])
    await opened.page.evaluateOnNewDocument(COUNT_FRAMES)
    await opened.page.evaluateOnNewDocument(() => localStorage.setItem('kc:prefs', JSON.stringify({ view: 'paper' })))
    await opened.page.goto(server.url + path, { waitUntil: 'load' })
    await ready(opened.page)
    return opened
  }

  try {
    // --- The control: with motion allowed, the front page's intro and the terminal's rain are seen moving ---
    {
      const { page, close } = await open('/', false)
      const front = await watch(page, 2000)
      await close()
      const terminal = await open('/terminal', false)
      await sleep(1500)
      const rain = await watch(terminal.page, 2000)
      await terminal.close()
      checks.expect('with motion allowed, the watching sees it (the intro, the rain)', moving(front) && moving(rain), 'info', `front: ${describe(front)} | terminal: ${describe(rain)}`)
    }

    // --- Each view, settled, with reduced motion ---
    for (const [view, path, settle] of [['the front page', '/', 2500], ['a story', '/research/brain-freeze', 1500], ['the terminal', '/terminal', 2500]] as const) {
      const { page, close } = await open(path, true)
      try {
        await sleep(settle)
        const seen = await watch(page)
        checks.expect(`nothing moves by itself (${view})`, !moving(seen), 'medium', describe(seen))
      } finally {
        await close()
      }
    }

    // --- The front page's globe, when it's there, stays put (no spin, no ripples) ---
    {
      const { page, close } = await open('/', true)
      try {
        await page.$eval('.page--front [data-globe]', (el) => el.scrollIntoView({ block: 'center' }))
        for (let i = 0; i < 60 && !(await page.$('.page--front .globe.is-live')); i++) await sleep(250)
        await sleep(1500)
        const seen = await watch(page)
        checks.expect("the globe doesn't spin", !moving(seen), 'medium', describe(seen))
        // Turning to a story is a jump, not a flight.
        await page.focus('.page--front .globe__stories [tabindex="0"]')
        await page.keyboard.press('ArrowDown')
        await sleep(300)
        const after = await watch(page, 1000)
        checks.expect('turning the globe to a story is a jump, not a flight', !moving({ ...after, frames: after.frames * 2 }), 'low', describe(after))

        // --- Opening a story: no words flying, no fades ---
        await page.evaluate(() => window.scrollTo(0, 0))
        let flew = false
        let animations = 0
        await page.click('.page--front .tile__link')
        for (let i = 0; i < 20; i++) {
          const now = await page.evaluate(() => ({ morph: !!document.querySelector('.morph'), animations: document.getAnimations().filter((a) => a.playState === 'running').length }))
          flew ||= now.morph
          animations = Math.max(animations, now.animations)
          await sleep(50)
        }
        checks.expect('opening a story swaps the page, with no words flying and no fades', !flew && !animations, 'medium', `${flew ? 'words flew' : ''} ${animations} animation(s) running`)
      } finally {
        await close()
      }
    }

    // --- On a phone: the text scrolls with the page (no trailing), and a tab's panel is there at once (no glide) ---
    {
      const { page, close } = await open('/', true, 'mobile')
      try {
        await sleep(1500)
        // Where the text sits on the page, before and all through a scroll: it should never be anywhere else.
        const trailing = await page.evaluate(async () => {
          const text = [...document.querySelectorAll<HTMLElement>('.pager__panel:not([inert]) :is(p, h2, h3)')].filter((el) => el.getClientRects().length)
          const at = () => text.map((el) => el.getBoundingClientRect().top + scrollY)
          const rest = at()
          let most = 0
          for (let i = 0; i < 12; i++) {
            scrollBy(0, 30)
            await new Promise((r) => requestAnimationFrame(r))
            most = Math.max(most, at().filter((top, j) => Math.abs(top - rest[j]!) > 0.5).length)
          }
          return most
        })
        checks.expect("on a phone, the text doesn't trail the scroll", !trailing, 'medium', `${trailing} piece(s) trailing`)
        await page.click('.tabs__tab[data-panel="about"]')
        await sleep(40)
        const there = await page.evaluate(() => {
          const pager = document.querySelector('.pager')!
          return Math.abs(document.querySelector('#panel-about')!.getBoundingClientRect().left - pager.getBoundingClientRect().left) < 2
        })
        checks.expect("on a phone, a tab's panel is there at once, without gliding in", there, 'medium', 'still on its way')
      } finally {
        await close()
      }
    }

    // --- The terminal's cmatrix and full-screen globe hold still ---
    {
      const { page, close } = await open('/terminal', true)
      try {
        for (const [what, command] of [['cmatrix', 'cmatrix'], ['the full-screen globe', 'globe']] as const) {
          await terminalCommand(page, command)
          await sleep(1500)
          const seen = await watch(page)
          checks.expect(`${what} holds still`, !moving(seen), 'medium', describe(seen))
          await page.keyboard.press('Escape')
          await sleep(300)
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
