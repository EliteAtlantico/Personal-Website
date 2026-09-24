// Motion: what each animation costs while it runs. For a few seconds of each
// (the load-in intro, the globe turning, the rain, cmatrix, a story opening)
// it measures how much of the main thread the page uses, how many frames it
// draws and how many run long. With --profile it also samples the CPU and
// names the functions the time went to (from source maps: build with
// PERF_SOURCEMAP=1 to get them).
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import type { Browser, CDPSession, Page } from 'puppeteer-core'
import { SourceMapConsumer } from 'source-map-js'
import { appears, box as boxOf, mainThread, openPage, ready, sleep, table, terminalCommand } from './lib'

interface FrameScenario {
  name: string
  route: string
  /** Measure the first moments of a fresh load (the intro), instead of a settled page. */
  fresh?: boolean
  /** Before measuring: wait out the intro, open an overlay... */
  setup?(page: Page): Promise<void>
  /** While measuring (moving the mouse...); otherwise the page is left alone. */
  during?(page: Page, ms: number): Promise<void>
  ms: number
}

/** The mouse, back and forth across an element, a move every frame. */
async function sweep(page: Page, selector: string, duration: number) {
  const box = await boxOf(page, selector)
  const end = Date.now() + duration
  for (let t = 0; Date.now() < end; t += 1) {
    const x = box.x + box.width * (0.5 + 0.45 * Math.sin(t / 25))
    const y = box.y + box.height * (0.5 + 0.4 * Math.sin(t / 11))
    await page.mouse.move(x, y)
    await sleep(16)
  }
}

/** A drag in slow circles, as someone turning the globe. */
async function drag(page: Page, selector: string, duration: number) {
  const box = await boxOf(page, selector)
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  const end = Date.now() + duration
  for (let t = 0; Date.now() < end; t += 1) {
    await page.mouse.move(cx + Math.cos(t / 20) * box.width * 0.25, cy + Math.sin(t / 20) * box.height * 0.15)
    await sleep(16)
  }
  await page.mouse.up()
}

export const FRAME_SCENARIOS: FrameScenario[] = [
  { name: 'paper: the intro, first 4 s', route: '/', fresh: true, ms: 4000 },
  {
    name: 'paper: settled, globe turning',
    route: '/',
    setup: async (page) => {
      await sleep(5000)
      await page.$eval('.tile--globe', (el) => el.scrollIntoView({ block: 'center' }))
      await appears(page, '.tile--globe canvas')
      await sleep(1000)
    },
    ms: 4000,
  },
  {
    name: 'paper: mouse over the banner',
    route: '/',
    setup: () => sleep(5000),
    during: (page, ms) => sweep(page, '.masthead__banner', ms),
    ms: 3000,
  },
  {
    name: 'paper: mouse over the bio chip',
    route: '/',
    setup: async (page) => {
      await sleep(5000)
      await page.$eval('.bio', (el) => el.scrollIntoView({ block: 'center' }))
      await sleep(500)
    },
    during: (page, ms) => sweep(page, '.bio__chip', ms),
    ms: 2000,
  },
  {
    name: 'paper: opening a story',
    route: '/',
    setup: () => sleep(5000),
    during: async (page, ms) => {
      await page.click('.tile--story .tile__link')
      await sleep(ms)
    },
    ms: 1500,
  },
  { name: 'terminal: dashboard (rain + globe)', route: '/terminal', setup: () => sleep(2500), ms: 4000 },
  {
    name: 'terminal: mouse through the rain',
    route: '/terminal',
    setup: () => sleep(2500),
    during: (page, ms) => sweep(page, '.t-dash .t-rain', ms),
    ms: 3000,
  },
  {
    name: 'terminal: cmatrix, mouse moving',
    route: '/terminal',
    setup: async (page) => {
      await sleep(1500)
      await terminalCommand(page, 'cmatrix')
      await appears(page, '.terminal__matrix canvas')
      await sleep(1000)
    },
    during: (page, ms) => sweep(page, '.terminal__matrix .t-rain', ms),
    ms: 4000,
  },
  {
    name: 'terminal: globe full screen, dragging',
    route: '/terminal',
    setup: async (page) => {
      await sleep(1500)
      await terminalCommand(page, 'globe')
      await appears(page, '.terminal__globe canvas')
      await sleep(1000)
    },
    during: (page, ms) => drag(page, '.terminal__globe canvas', ms),
    ms: 3000,
  },
]

export interface FrameResult {
  name: string
  /** Frames drawn per second. */
  fps: number
  /** Main-thread ms used per second of animation, in all and by kind. */
  busy: number
  script: number
  layout: number
  style: number
  /** Frames longer than 50 ms, and the longest. */
  longFrames: number
  worst: number
  hot?: Array<{ where: string; ms: number }>
}

export async function frames(browser: Browser, base: string, { profile = false, only }: { profile?: boolean; only?: string } = {}): Promise<FrameResult[]> {
  const results: FrameResult[] = []
  const maps = profile ? sourceMaps() : null
  for (const scenario of FRAME_SCENARIOS) {
    if (only && !scenario.name.includes(only)) continue
    const opened = await openPage(browser, 'desktop')
    const { page, cdp } = opened
    try {
      if (scenario.fresh) {
        await page.goto(base + scenario.route, { waitUntil: 'domcontentloaded' })
        await (await page.waitForFunction(() => !!(window as unknown as { __perf?: { revealed?: number } }).__perf?.revealed, { polling: 16 })).dispose()
      } else {
        await page.goto(base + scenario.route, { waitUntil: 'load' })
        await ready(page)
        await scenario.setup?.(page)
      }
      results.push({ name: scenario.name, ...(await window_(page, cdp, scenario, maps)) })
    } catch (error) {
      console.error(`  ${scenario.name}: ${(error as Error).message}`)
    } finally {
      await opened.close()
    }
  }
  return results
}

async function window_(page: Page, cdp: CDPSession, scenario: FrameScenario, maps: Maps | null) {
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number; __long: number[]; __raf: number }
    w.__frames = 0
    w.__long = []
    const tick = () => {
      w.__frames++
      w.__raf = requestAnimationFrame(tick)
    }
    w.__raf = requestAnimationFrame(tick)
    try {
      new PerformanceObserver((list) => list.getEntries().forEach((e) => w.__long.push(e.duration))).observe({ type: 'long-animation-frame' })
    } catch {
      // Not in this browser.
    }
  })
  if (maps) {
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
    await cdp.send('Profiler.start')
  }
  const before = await mainThread(cdp)
  const started = Date.now()
  if (scenario.during) await scenario.during(page, scenario.ms)
  else await sleep(scenario.ms)
  const after = await mainThread(cdp)
  const seconds = (Date.now() - started) / 1000
  const hot = maps ? hotspots((await cdp.send('Profiler.stop')).profile, maps) : undefined
  const { count, long } = await page.evaluate(() => {
    const w = window as unknown as { __frames: number; __long: number[]; __raf: number }
    cancelAnimationFrame(w.__raf)
    return { count: w.__frames, long: w.__long }
  })
  return {
    fps: count / seconds,
    busy: (after.task - before.task) / seconds,
    script: (after.script - before.script) / seconds,
    layout: (after.layout - before.layout) / seconds,
    style: (after.style - before.style) / seconds,
    longFrames: long.length,
    worst: Math.max(0, ...long),
    hot,
  }
}

// --- Naming where the CPU time went ---

type Maps = Map<string, SourceMapConsumer>

/** dist/assets/*.js.map, when the build made them (PERF_SOURCEMAP=1). */
function sourceMaps(): Maps {
  const maps: Maps = new Map()
  const assets = path.resolve('dist/assets')
  for (const file of existsSync(assets) ? readdirSync(assets) : []) {
    if (file.endsWith('.js.map')) maps.set(file.slice(0, -'.map'.length), new SourceMapConsumer(JSON.parse(readFileSync(path.join(assets, file), 'utf8'))))
  }
  if (!maps.size) console.log('  (no source maps in dist/assets: build with PERF_SOURCEMAP=1 to name functions)')
  return maps
}

interface ProfileNode {
  id: number
  callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number }
}

function hotspots(profile: { nodes: ProfileNode[]; samples?: number[]; timeDeltas?: number[] }, maps: Maps) {
  const self = new Map<number, number>()
  profile.samples?.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas?.[i] ?? 0) / 1000))
  const byPlace = new Map<string, number>()
  for (const node of profile.nodes) {
    const time = self.get(node.id)
    if (!time) continue
    const { functionName, url, lineNumber, columnNumber } = node.callFrame
    let where = functionName || '(anonymous)'
    const map = maps.get(url.split('/').pop() ?? '')
    if (map) {
      const original = map.originalPositionFor({ line: lineNumber + 1, column: columnNumber })
      if (original.source) where = `${original.name ?? functionName ?? '?'} ${original.source.replace(/^.*?(src|node_modules)\//, '$1/')}:${original.line}`
    } else if (!url) where = `[${where}]`
    byPlace.set(where, (byPlace.get(where) ?? 0) + time)
  }
  return [...byPlace]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([where, ms]) => ({ where, ms: Math.round(ms * 10) / 10 }))
}

export function printFrames(results: FrameResult[]) {
  table(
    results.map((r) => ({
      scenario: r.name,
      fps: r.fps.toFixed(0),
      'main thread': `${Math.round(r.busy)} ms/s`,
      script: `${Math.round(r.script)} ms/s`,
      'style+layout': `${Math.round(r.style + r.layout)} ms/s`,
      'long frames': r.longFrames ? `${r.longFrames} (worst ${Math.round(r.worst)} ms)` : '0',
    })),
  )
  for (const r of results) {
    if (!r.hot?.length) continue
    console.log(`\n${r.name}: where the CPU went`)
    for (const { where, ms } of r.hot) console.log(`  ${String(ms).padStart(7)} ms  ${where}`)
  }
}
