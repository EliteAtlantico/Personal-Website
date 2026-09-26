// What the performance suite (perf/run.ts) is built on: the built site served
// by the desk's own server (server/site.ts), a headless Chrome driven over the
// DevTools protocol, and ways to read what a page is holding on to.
import { existsSync, readdirSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import puppeteer, { type Browser, type CDPSession, type Page } from 'puppeteer-core'
import { site } from '../server/site'

/** dist/, served on a free port, exactly as the desk serves it. */
export async function serve(dist = 'dist') {
  dist = path.resolve(dist)
  if (!existsSync(path.join(dist, 'index.html'))) throw new Error('No dist/ to measure: run `bun run build` first.')
  const server = createServer(site({ dist }))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close() {
      server.closeAllConnections?.()
      server.close()
    },
  }
}

/** A Chrome or Chromium: $CHROME, an installed Chrome, or one Playwright downloaded. */
export function findChrome(): string {
  if (process.env.CHROME) return process.env.CHROME
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]
  const home = os.homedir()
  // Puppeteer's headless-only build: bunx @puppeteer/browsers install chrome-headless-shell@stable --path ~/.cache/puppeteer
  const shells = path.join(home, '.cache/puppeteer/chrome-headless-shell')
  if (existsSync(shells)) {
    for (const build of readdirSync(shells).sort().reverse()) {
      for (const platform of ['mac-arm64', 'mac-x64', 'linux64']) candidates.push(path.join(shells, build, `chrome-headless-shell-${platform}`, 'chrome-headless-shell'))
    }
  }
  for (const cache of [path.join(home, 'Library/Caches/ms-playwright'), path.join(home, '.cache/ms-playwright')]) {
    if (!existsSync(cache)) continue
    const builds = readdirSync(cache)
      .filter((dir) => /^chromium-\d+$/.test(dir))
      .sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)))
    for (const build of builds) {
      candidates.push(
        path.join(cache, build, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
        path.join(cache, build, 'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
        path.join(cache, build, 'chrome-linux64/chrome'),
        path.join(cache, build, 'chrome-linux/chrome'),
      )
    }
  }
  const found = candidates.find((file) => existsSync(file))
  if (!found) throw new Error('No Chrome or Chromium found: set CHROME=/path/to/chrome.')
  return found
}

/**
 * A headless Chrome. `steady`, for counting leaks: JavaScript runs without its
 * optimizing compilers, whose code keeps piling up for a while as a page's
 * functions get hot, which would look like a leak (it isn't: it levels off).
 */
export function launch({ steady = false } = {}): Promise<Browser> {
  const executablePath = findChrome()
  return puppeteer.launch({
    executablePath,
    // The headless-only build runs the older headless mode; full Chrome, the new one.
    headless: executablePath.endsWith('chrome-headless-shell') ? 'shell' : true,
    defaultViewport: null,
    args: [
      // Exact heap numbers, and gc() for the page, so a leak isn't lost in the noise.
      '--enable-precise-memory-info',
      steady ? '--js-flags=--expose-gc --no-sparkplug --no-maglev --no-turbofan --no-flush-bytecode' : '--js-flags=--expose-gc',
      // Frames and timers at full speed, as in a tab someone is looking at.
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--hide-scrollbars',
      '--mute-audio',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  })
}

export interface Throttle {
  /** Round trip, ms. */
  rtt: number
  /** Bits per second. */
  down: number
  up: number
  /** CPU slowdown (4 is roughly a mid-range phone, next to a laptop). */
  cpu: number
}

/** Lighthouse's mobile profile ("slow 4G" on a mid-range phone), and a laptop on good Wi-Fi. */
export const PROFILES = {
  mobile: { viewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true }, throttle: { rtt: 150, down: 1.6e6, up: 750e3, cpu: 4 } },
  desktop: { viewport: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false }, throttle: { rtt: 40, down: 10e6, up: 5e6, cpu: 1 } },
} satisfies Record<string, { viewport: Parameters<Page['setViewport']>[0]; throttle: Throttle }>

/**
 * Runs before the page's own scripts: notes when the page is revealed (the
 * pt-pending class comes off) and laid out (main[data-laid-out]), and keeps
 * the Largest Contentful Paint, layout shifts and long tasks as they happen.
 */
const INSTRUMENT = () => {
  const perf = ((window as unknown as { __perf: Record<string, unknown> }).__perf = { lcp: 0, lcpElement: '', cls: 0, longTasks: [] as number[][] } as Record<string, unknown>)
  // This runs before there's an <html> element, so it watches the document for it.
  new MutationObserver(() => {
    const root = document.documentElement
    if (!root) return
    if (!perf.pending && root.classList.contains('pt-pending')) perf.pending = performance.now()
    if (perf.pending && !perf.revealed && !root.classList.contains('pt-pending')) perf.revealed = performance.now()
    if (!perf.laidOut && document.querySelector('main[data-laid-out], .terminal.is-live')) perf.laidOut = performance.now()
  }).observe(document, { attributes: true, childList: true, subtree: true, attributeFilter: ['class', 'data-laid-out'] })
  const observe = (type: string, each: (entry: PerformanceEntry & Record<string, unknown>) => void) => {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach((entry) => each(entry as PerformanceEntry & Record<string, unknown>))).observe({ type, buffered: true })
    } catch {
      // Not in this browser.
    }
  }
  observe('largest-contentful-paint', (entry) => {
    perf.lcp = entry.startTime
    const el = entry.element as Element | null
    perf.lcpElement = el ? `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : ''}` : ''
  })
  observe('layout-shift', (entry) => {
    if (!entry.hadRecentInput) perf.cls = (perf.cls as number) + (entry.value as number)
  })
  observe('longtask', (entry) => (perf.longTasks as number[][]).push([entry.startTime, entry.duration]))
}

export interface Opened {
  page: Page
  cdp: CDPSession
  /** Bytes over the wire, by kind of resource. */
  bytes: Record<string, number>
  requests: number
  close(): Promise<void>
}

/**
 * A fresh browser profile (empty cache and storage) with one page, optionally
 * throttled, and counting the bytes it downloads (which DevTools remembers, so
 * leave it off when measuring memory).
 */
export async function openPage(browser: Browser, profile: keyof typeof PROFILES, options: { throttle?: boolean; network?: boolean } = {}): Promise<Opened> {
  const { throttle = false, network = throttle } = options
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  const { viewport, throttle: slow } = PROFILES[profile]
  await page.setViewport(viewport)
  const cdp = await page.createCDPSession()
  await cdp.send('Performance.enable')
  if (network) await cdp.send('Network.enable')
  const opened: Opened = { page, cdp, bytes: {}, requests: 0, close: () => context.close() }
  const kinds = new Map<string, string>()
  cdp.on('Network.responseReceived', (event) => kinds.set(event.requestId, event.type))
  cdp.on('Network.loadingFinished', (event) => {
    const kind = kinds.get(event.requestId) ?? 'Other'
    opened.bytes[kind] = (opened.bytes[kind] ?? 0) + event.encodedDataLength
    opened.requests++
  })
  if (throttle) {
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: slow.rtt, downloadThroughput: slow.down / 8, uploadThroughput: slow.up / 8 })
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: slow.cpu })
  }
  await page.evaluateOnNewDocument(INSTRUMENT)
  return opened
}

/** Until the page is shown and laid out (or the terminal is live). */
export async function ready(page: Page, timeout = 20_000) {
  const handle = await page.waitForFunction(() => {
    const perf = (window as unknown as { __perf?: { revealed?: number; laidOut?: number } }).__perf
    return !!perf?.revealed && !!perf.laidOut && document.querySelectorAll('#app > .page').length === 1
  }, { timeout, polling: 50 })
  await handle.dispose()
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Collects garbage properly: a few rounds, so what's left is what's really held on to. */
export async function gc(page: Page, cdp: CDPSession) {
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => (globalThis as { gc?: () => void }).gc?.())
    await cdp.send('HeapProfiler.collectGarbage')
  }
}

/** How many objects of a kind (a DOM or WebGL class) are alive, attached to the page or not. */
export async function alive(page: Page, className: string): Promise<number> {
  const prototype = await page.evaluateHandle((name) => (globalThis as unknown as Record<string, { prototype?: object }>)[name]?.prototype ?? {}, className)
  const objects = await page.queryObjects(prototype)
  const count = await page.evaluate((list) => (list as unknown[]).length, objects)
  await Promise.all([objects.dispose(), prototype.dispose()])
  return count
}

export interface Sample {
  /** Bytes of JavaScript heap in use, after collecting garbage. */
  heap: number
  /** DOM nodes alive (in the page or detached), and event listeners. */
  nodes: number
  listeners: number
  /** Canvases alive (in the page or not), their pixels, and WebGL contexts not yet lost. */
  canvases: number
  canvasPixels: number
  webgl: number
  /** Pictures kept as data: URLs, in characters. */
  dataUrls: number
  /** DOM trees taken out of the page but still held on to (the classic leak), and what they are. */
  detached: number
  detachedRoots: string[]
  /** Nodes in the terminal's scrollback, which is kept on purpose (up to 2,000 blocks). */
  scrollback: number
}

/** What the page holds on to right now. */
export async function sample(page: Page, cdp: CDPSession): Promise<Sample> {
  await gc(page, cdp)
  const { metrics } = await cdp.send('Performance.getMetrics')
  const metric = (name: string) => metrics.find((m) => m.name === name)?.value ?? 0
  const canvasPrototype = await page.evaluateHandle(() => HTMLCanvasElement.prototype)
  const canvases = await page.queryObjects(canvasPrototype)
  const pixels = await page.evaluate((list) => {
    const all = list as HTMLCanvasElement[]
    return { count: all.length, pixels: all.reduce((sum, canvas) => sum + canvas.width * canvas.height, 0) }
  }, canvases)
  await Promise.all([canvases.dispose(), canvasPrototype.dispose()])
  const contexts: number[] = []
  for (const name of ['WebGLRenderingContext', 'WebGL2RenderingContext']) {
    const prototype = await page.evaluateHandle((n) => (globalThis as unknown as Record<string, { prototype?: object }>)[n]?.prototype ?? {}, name)
    const list = await page.queryObjects(prototype)
    contexts.push(await page.evaluate((all) => (all as WebGLRenderingContext[]).filter((gl) => !gl.isContextLost()).length, list))
    await Promise.all([list.dispose(), prototype.dispose()])
  }
  const dataUrls = await page.evaluate(() => [...document.querySelectorAll('img')].reduce((sum, img) => sum + (img.src.startsWith('data:') ? img.src.length : 0), 0))
  let detached = 0
  let detachedRoots: string[] = []
  try {
    await cdp.send('DOM.enable')
    type Detached = { treeNode: { nodeName: string; attributes?: string[] }; retainedNodeIds: number[] }
    const { detachedNodes } = (await cdp.send('DOM.getDetachedDomNodes' as 'DOM.enable')) as unknown as { detachedNodes: Detached[] }
    detached = detachedNodes.length
    detachedRoots = detachedNodes.map(({ treeNode, retainedNodeIds }) => {
      const attrs = treeNode.attributes ?? []
      const cls = attrs[attrs.indexOf('class') + 1]
      return `${treeNode.nodeName.toLowerCase()}${attrs.includes('class') && cls ? `.${cls.split(' ')[0]}` : ''} (${retainedNodeIds.length} nodes)`
    })
  } catch {
    // Older Chrome: not counted.
  } finally {
    // DevTools holds on to every node it has reported while its DOM agent is on: let them go,
    // or each count would keep that moment's nodes alive and the next would find more.
    await cdp.send('DOM.disable').catch(() => undefined)
  }
  const divPrototype = await page.evaluateHandle(() => HTMLDivElement.prototype)
  const divs = await page.queryObjects(divPrototype)
  const scrollback = await page.evaluate((all) => {
    let count = 0
    for (const div of all as HTMLDivElement[]) {
      if (!div.classList.contains('terminal__output')) continue
      const walker = document.createTreeWalker(div)
      count++
      while (walker.nextNode()) count++
    }
    return count
  }, divs)
  await Promise.all([divs.dispose(), divPrototype.dispose()])
  return {
    heap: metric('JSHeapUsedSize'),
    nodes: metric('Nodes'),
    listeners: metric('JSEventListeners'),
    canvases: pixels.count,
    canvasPixels: pixels.pixels,
    webgl: contexts.reduce((a, b) => a + b, 0),
    dataUrls,
    detached,
    detachedRoots,
    scrollback,
  }
}

/** Main-thread time (ms) the page has used so far, by kind. */
export async function mainThread(cdp: CDPSession) {
  const { metrics } = await cdp.send('Performance.getMetrics')
  const metric = (name: string) => (metrics.find((m) => m.name === name)?.value ?? 0) * 1000
  return { task: metric('TaskDuration'), script: metric('ScriptDuration'), layout: metric('LayoutDuration'), style: metric('RecalcStyleDuration') }
}

// --- Driving the site ---

/**
 * Waits for an element without holding on to it. (page.waitForSelector hands back
 * a handle that keeps the element alive until it's disposed, which would look
 * exactly like a leak.)
 */
export async function appears(page: Page, selector: string, timeout = 15_000) {
  const handle = await page.waitForFunction((s) => !!document.querySelector(s), { polling: 50, timeout }, selector)
  await handle.dispose()
}

export async function gone(page: Page, selector: string, timeout = 15_000) {
  const handle = await page.waitForFunction((s) => !document.querySelector(s), { polling: 50, timeout }, selector)
  await handle.dispose()
}

/** An element's box on screen, without holding on to the element. */
export async function box(page: Page, selector: string) {
  return page.$eval(selector, (el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  })
}

export async function terminalCommand(page: Page, command: string) {
  await page.focus('#terminal-input')
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

/** Clicks a link the router handles, and waits for the new page to settle. */
export async function follow(page: Page, selector: string) {
  const before = await page.evaluate(() => location.pathname)
  await page.click(selector)
  await (await page.waitForFunction((from) => location.pathname !== from, {}, before)).dispose()
  await settled(page)
}

export async function back(page: Page) {
  const before = await page.evaluate(() => location.pathname)
  // The router's pages are one document: going back is a popstate, not a page load.
  await page.evaluate(() => history.back())
  await (await page.waitForFunction((from) => location.pathname !== from, {}, before)).dispose()
  await settled(page)
}

/** The router's transition is over: one page, laid out. */
export async function settled(page: Page) {
  const handle = await page.waitForFunction(() => document.querySelectorAll('#app > .page').length === 1 && !!document.querySelector('#app > .page main[data-laid-out], #app > .page .terminal.is-live'), { polling: 50, timeout: 15_000 })
  await handle.dispose()
  await sleep(150)
}

// --- Printing ---

export const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`
export const ms = (value: number | undefined) => (value === undefined ? '-' : `${Math.round(value)} ms`)

export function table(rows: Array<Record<string, string | number>>) {
  if (!rows.length) return
  const columns = Object.keys(rows[0]!)
  const widths = columns.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)))
  const line = (cells: string[]) => cells.map((cell, i) => (i ? cell.padStart(widths[i]!) : cell.padEnd(widths[i]!))).join('  ')
  console.log(line(columns))
  console.log(line(widths.map((w) => '-'.repeat(w))))
  for (const row of rows) console.log(line(columns.map((c) => String(row[c] ?? ''))))
}
