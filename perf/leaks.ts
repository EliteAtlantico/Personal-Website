// Leaks: do the same thing over and over (open a story and come back, open
// the globe and close it) and see whether the page holds on to more each
// time. A page that doesn't leak ends each round where it started: the same
// heap, DOM nodes, listeners, canvases and WebGL contexts.
import type { Browser, Page } from 'puppeteer-core'
import { appears, back, follow, gone, kb, openPage, ready, sample, sleep, table, terminalCommand, type Sample } from './lib'

interface Scenario {
  name: string
  route: string
  step(page: Page): Promise<void>
  /** What's expected to pile up by design, so it isn't called a leak. */
  grows?: Array<keyof Sample>
}

type Counted = Exclude<keyof Sample, 'detachedRoots'>

/** Before each count: long enough for every animation and timer a round started to finish. */
const QUIET = 2500

const overlay = async (page: Page, command: string, selector: string) => {
  await terminalCommand(page, command)
  await appears(page, selector)
  await sleep(400)
  await page.keyboard.press('q')
  await gone(page, selector.split(' ')[0]!)
  await sleep(100)
}

export const SCENARIOS: Scenario[] = [
  {
    name: 'open a story, come back (paper)',
    route: '/',
    step: async (page) => {
      await follow(page, '.tile--story .tile__link')
      await back(page)
    },
  },
  {
    name: 'paper to terminal and back',
    route: '/',
    step: async (page) => {
      await follow(page, 'a[data-view="terminal"]')
      await appears(page, '#terminal-input')
      await follow(page, 'a[data-view="paper"]')
    },
  },
  {
    name: 'globe, full screen, and q (terminal)',
    route: '/terminal',
    step: (page) => overlay(page, 'globe', '.terminal__globe canvas'),
  },
  {
    name: 'cmatrix and q (terminal)',
    route: '/terminal',
    step: (page) => overlay(page, 'cmatrix', '.terminal__matrix canvas'),
  },
  {
    name: 'open a story in the reader, and q (terminal)',
    route: '/terminal',
    step: async (page) => {
      await page.click('.t-dash .t-row[data-run^="open "]')
      await appears(page, '.terminal__reader')
      await sleep(200)
      await page.keyboard.press('q')
      await gone(page, '.terminal__reader')
    },
  },
  {
    name: 'dashboard again (terminal)',
    route: '/terminal',
    // Each dashboard stays in the scrollback (up to 2,000 blocks), like any terminal output.
    grows: ['heap', 'listeners'],
    step: async (page) => {
      const before = await page.$$eval('.t-dash', (all) => all.length)
      await terminalCommand(page, 'dashboard')
      await (await page.waitForFunction((n) => document.querySelectorAll('.t-dash').length > n, {}, before)).dispose()
      await sleep(900)
    },
  },
]

export interface LeakResult {
  name: string
  /** Rounds between `before` and `after` (the second half). */
  rounds: number
  /** After the warm-up, after the first half of the rounds, and at the end. */
  start: Sample
  before: Sample
  after: Sample
  grows: Array<keyof Sample>
}

export async function leaks(browser: Browser, base: string, rounds: number, only?: string): Promise<LeakResult[]> {
  const results: LeakResult[] = []
  for (const scenario of SCENARIOS) {
    if (only && !scenario.name.includes(only)) continue
    const opened = await openPage(browser, 'desktop')
    const { page, cdp } = opened
    try {
      await page.goto(base + scenario.route, { waitUntil: 'load' })
      await ready(page)
      await sleep(1500)
      // Twice first, so what's loaded once and kept on purpose (code, caches) isn't counted. Then the
      // rounds, in two halves: the JavaScript engine keeps compiling hot code for a while, which
      // levels off, so only growth that carries on through the second half is a leak.
      for (let i = 0; i < 2; i++) await scenario.step(page)
      await sleep(QUIET)
      const start = await sample(page, cdp)
      const half = Math.max(1, Math.round(rounds / 2))
      for (let i = 0; i < half; i++) await scenario.step(page)
      await sleep(QUIET)
      const before = await sample(page, cdp)
      for (let i = 0; i < half; i++) await scenario.step(page)
      await sleep(QUIET)
      const after = await sample(page, cdp)
      results.push({ name: scenario.name, rounds: half, start, before, after, grows: scenario.grows ?? [] })
    } catch (error) {
      console.error(`  ${scenario.name}: ${(error as Error).message}`)
    } finally {
      await opened.close()
    }
  }
  return results
}

/** A leak: steady growth every round, past what noise can explain. */
export function leaked(r: LeakResult): string[] {
  const per = (key: Counted) => (r.after[key] - r.before[key]) / r.rounds
  const found: string[] = []
  // The scrollback is kept on purpose, so it's left out of the node count.
  const nodes = (per('nodes') - per('scrollback'))
  if (per('heap') > 24 * 1024 && !r.grows.includes('heap')) found.push(`heap +${kb(per('heap'))}/round`)
  if (nodes >= 1 && !r.grows.includes('nodes')) found.push(`+${nodes.toFixed(1)} nodes/round`)
  if (per('listeners') >= 1 && !r.grows.includes('listeners')) found.push(`+${per('listeners').toFixed(1)} listeners/round`)
  if (per('canvases') > 0) found.push(`+${per('canvases').toFixed(1)} canvases/round`)
  if (per('canvasPixels') > 0) found.push(`+${Math.round(per('canvasPixels') * 4 / 1024)} KB of canvas/round`)
  if (per('webgl') > 0) found.push(`+${per('webgl').toFixed(1)} WebGL contexts/round`)
  if (per('dataUrls') > 0) found.push(`+${kb(per('dataUrls'))} of data: pictures/round`)
  if (per('detached') > 0) found.push(`+${per('detached').toFixed(1)} detached DOM trees/round`)
  return found
}

export function printLeaks(results: LeakResult[]) {
  table(
    results.map((r) => {
      const d = (key: Counted) => r.after[key] - r.before[key]
      const verdict = leaked(r)
      return {
        scenario: `${r.name} ×${r.rounds * 2}`,
        heap: `${kb(r.start.heap)} → ${kb(r.before.heap)} → ${kb(r.after.heap)}`,
        nodes: `${r.start.nodes} → ${r.after.nodes}${r.after.scrollback - r.start.scrollback ? ` (+${r.after.scrollback - r.start.scrollback} scrollback)` : ''}`,
        listeners: `${d('listeners') >= 0 ? '+' : ''}${d('listeners')}`,
        canvases: `${r.start.canvases} → ${r.after.canvases}`,
        'canvas memory': `${kb(r.start.canvasPixels * 4)} → ${kb(r.after.canvasPixels * 4)}`,
        WebGL: `${r.start.webgl} → ${r.after.webgl}`,
        detached: `${r.start.detached} → ${r.after.detached}`,
        verdict: verdict.length ? `LEAK: ${verdict.join(', ')}` : 'ok',
      }
    }),
  )
  for (const r of results) {
    if (r.after.detached > r.before.detached) console.log(`  ${r.name}: still held after it left the page: ${r.after.detachedRoots.join(', ')}`)
  }
}
