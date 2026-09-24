// First visits: how long until someone sees the page, and what it cost to get
// there. Each run is a fresh browser profile (nothing cached), throttled like
// Lighthouse's mobile test (slow 4G, a CPU four times slower) or a laptop on
// good Wi-Fi.
import type { Browser } from 'puppeteer-core'
import { hotspots, type Maps } from './frames'
import { kb, mainThread, ms, openPage, PROFILES, ready, sleep, table } from './lib'

export interface LoadResult {
  route: string
  profile: keyof typeof PROFILES
  /** First Contentful Paint and Largest Contentful Paint, ms. */
  fcp: number
  lcp: number
  lcpElement: string
  /** When the page was shown (pt-pending came off) and fully laid out, ms. */
  revealed: number
  laidOut: number
  cls: number
  /** Total Blocking Time after the first paint, ms. */
  tbt: number
  requests: number
  /** Bytes over the wire, total and by kind. */
  total: number
  bytes: Record<string, number>
  /** JavaScript heap once the page has settled. */
  heap: number
  /** Main-thread time used, ms. */
  main: number
  /** With --profile: where the CPU time went, from the start until the page was shown. */
  hot?: Array<{ where: string; ms: number }>
}

export const ROUTES = ['/', '/terminal', '/research/brain-freeze']

export async function measureLoad(browser: Browser, base: string, route: string, profile: keyof typeof PROFILES, maps: Maps | null = null): Promise<LoadResult> {
  const opened = await openPage(browser, profile, { throttle: true })
  const { page, cdp } = opened
  try {
    if (maps) {
      await cdp.send('Profiler.enable')
      await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
      await cdp.send('Profiler.start')
    }
    await page.goto(base + route, { waitUntil: 'load', timeout: 60_000 })
    await ready(page, 60_000)
    const hot = maps ? hotspots((await cdp.send('Profiler.stop')).profile, maps) : undefined
    // What loads after the page shows (the globe, the terminal) arrives and settles too.
    await page.waitForNetworkIdle({ idleTime: 1000, timeout: 60_000 }).catch(() => undefined)
    await sleep(1000)
    const perf = await page.evaluate(() => {
      const p = (window as unknown as { __perf: Record<string, unknown> }).__perf
      const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0
      const tbt = (p.longTasks as number[][]).filter(([start]) => start! >= fcp).reduce((sum, [, duration]) => sum + Math.max(0, duration! - 50), 0)
      return { fcp, lcp: p.lcp as number, lcpElement: p.lcpElement as string, revealed: p.revealed as number, laidOut: p.laidOut as number, cls: p.cls as number, tbt }
    })
    const { metrics } = await cdp.send('Performance.getMetrics')
    const heap = metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0
    return {
      route,
      profile,
      ...perf,
      requests: opened.requests,
      total: Object.values(opened.bytes).reduce((a, b) => a + b, 0),
      bytes: { ...opened.bytes },
      heap,
      main: (await mainThread(cdp)).task,
      hot,
    }
  } finally {
    await opened.close()
  }
}

/** The median run of several, metric by metric (first visits are noisy). */
export async function loads(browser: Browser, base: string, runs: number, maps: Maps | null = null, only?: string): Promise<LoadResult[]> {
  const results: LoadResult[] = []
  for (const profile of Object.keys(PROFILES) as Array<keyof typeof PROFILES>) {
    for (const route of ROUTES) {
      if (only && !`${route} (${profile})`.includes(only)) continue
      const all: LoadResult[] = []
      // Profiling slows what it watches, so only the first visit is profiled (and it doesn't count).
      if (maps) all.push(await measureLoad(browser, base, route, profile, maps))
      for (let i = 0; i < runs; i++) all.push(await measureLoad(browser, base, route, profile))
      const profiled = maps ? all.shift() : undefined
      const median = (pick: (r: LoadResult) => number) => {
        const sorted = all.map(pick).sort((a, b) => a - b)
        return sorted[sorted.length >> 1]!
      }
      const bytes: Record<string, number> = {}
      for (const kind of new Set(all.flatMap((r) => Object.keys(r.bytes)))) bytes[kind] = median((r) => r.bytes[kind] ?? 0)
      results.push({
        route,
        profile,
        fcp: median((r) => r.fcp),
        lcp: median((r) => r.lcp),
        lcpElement: all[0]!.lcpElement,
        revealed: median((r) => r.revealed),
        laidOut: median((r) => r.laidOut),
        cls: median((r) => r.cls),
        tbt: median((r) => r.tbt),
        requests: median((r) => r.requests),
        total: median((r) => r.total),
        bytes,
        heap: median((r) => r.heap),
        main: median((r) => r.main),
        hot: profiled?.hot,
      })
    }
  }
  return results
}

export function printLoads(results: LoadResult[]) {
  table(
    results.map((r) => ({
      page: `${r.route} (${r.profile})`,
      FCP: ms(r.fcp),
      LCP: ms(r.lcp),
      shown: ms(r.revealed),
      'laid out': ms(r.laidOut),
      TBT: ms(r.tbt),
      CLS: r.cls.toFixed(3),
      requests: r.requests,
      transferred: kb(r.total),
      JS: kb(r.bytes.Script ?? 0),
      fonts: kb(r.bytes.Font ?? 0),
      images: kb(r.bytes.Image ?? 0),
      heap: kb(r.heap),
      'main thread': ms(r.main),
    })),
  )
  const lcp = results.map((r) => `${r.route} (${r.profile}): ${r.lcpElement || '?'}`)
  console.log(`\nLargest paint: ${lcp.join(' · ')}`)
  for (const r of results) {
    if (!r.hot?.length) continue
    console.log(`\n${r.route} (${r.profile}), until it was shown: where the CPU went`)
    for (const { where, ms } of r.hot) console.log(`  ${String(ms).padStart(7)} ms  ${where}`)
  }
}
