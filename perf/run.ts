// The performance suite: `bun run perf [load|leaks|frames] [options]`.
//
//   load     first visits to the front page, the terminal and a story, on a
//            throttled phone and a laptop: when the page shows, what it cost.
//   leaks    the same thing done over and over, checking nothing piles up.
//   frames   what each animation costs the main thread while it runs.
//
// With no suite named, it runs all three. It measures dist/ as it is, so
// build first. Options:
//   --runs N       first visits per page and profile (default 3; the median is kept)
//   --rounds N     repetitions per leak scenario (default 10)
//   --only TEXT    only the scenarios whose name contains TEXT
//   --profile      name the functions the CPU time went to (build with PERF_SOURCEMAP=1)
//   --save FILE    keep the results as JSON
//   --compare FILE show how they changed since a saved run
//   --dist DIR     measure another build than dist/ (a copy, so dist/ can be rebuilt meanwhile)
// It exits with an error if a leak is found.
import { readFileSync, writeFileSync } from 'node:fs'
import { frames, printFrames, sourceMaps, type FrameResult } from './frames'
import { leaked, leaks, printLeaks, type LeakResult } from './leaks'
import { kb, launch, ms, serve, table } from './lib'
import { loads, printLoads, type LoadResult } from './load'

const args = process.argv.slice(2)
const option = (name: string) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const suites = args.filter((arg, i) => !arg.startsWith('--') && !args[i - 1]?.startsWith('--') && ['load', 'leaks', 'frames'].includes(arg))
const run = (suite: string) => !suites.length || suites.includes(suite)

interface Results {
  load?: LoadResult[]
  leaks?: LeakResult[]
  frames?: FrameResult[]
}

const server = await serve(option('dist'))
const browser = await launch()
const results: Results = {}
let failed = false
try {
  console.log(`Chrome ${(await browser.version()).replace(/^\D+/, '')}, measuring ${server.url}\n`)
  if (run('load')) {
    console.log('First visits (median of each)')
    results.load = await loads(browser, server.url, Number(option('runs') ?? 3), args.includes('--profile') ? sourceMaps(option('dist')) : null, option('only'))
    printLoads(results.load)
    console.log()
  }
  if (run('leaks')) {
    console.log('Leaks')
    const steady = await launch({ steady: true })
    try {
      results.leaks = await leaks(steady, server.url, Number(option('rounds') ?? 10), option('only'))
    } finally {
      await steady.close()
    }
    printLeaks(results.leaks)
    failed = results.leaks.some((r) => leaked(r).length > 0)
    console.log()
  }
  if (run('frames')) {
    console.log('Motion')
    results.frames = await frames(browser, server.url, { profile: args.includes('--profile'), only: option('only'), dist: option('dist') })
    printFrames(results.frames)
    console.log()
  }
} finally {
  await browser.close()
  server.close()
}

const save = option('save')
if (save) writeFileSync(save, JSON.stringify(results, null, 2))
const compare = option('compare')
if (compare) printComparison(JSON.parse(readFileSync(compare, 'utf8')) as Results, results)
process.exit(failed ? 1 : 0)

function printComparison(before: Results, after: Results) {
  const change = (a: number, b: number, format: (n: number) => string) => {
    const pct = a ? Math.round(((b - a) / a) * 100) : 0
    return `${format(a)} → ${format(b)} (${pct > 0 ? '+' : ''}${pct}%)`
  }
  if (before.load && after.load) {
    console.log('First visits, then and now')
    table(
      after.load.flatMap((b) => {
        const a = before.load!.find((x) => x.route === b.route && x.profile === b.profile)
        if (!a) return []
        return [
          {
            page: `${b.route} (${b.profile})`,
            LCP: change(a.lcp, b.lcp, ms),
            shown: change(a.revealed, b.revealed, ms),
            TBT: change(a.tbt, b.tbt, ms),
            transferred: change(a.total, b.total, kb),
            JS: change(a.bytes.Script ?? 0, b.bytes.Script ?? 0, kb),
            heap: change(a.heap, b.heap, kb),
            'main thread': change(a.main, b.main, ms),
          },
        ]
      }),
    )
    console.log()
  }
  if (before.frames && after.frames) {
    console.log('Motion, then and now (main-thread ms per second)')
    table(
      after.frames.flatMap((b) => {
        const a = before.frames!.find((x) => x.name === b.name)
        return a ? [{ scenario: b.name, 'main thread': change(a.busy, b.busy, (n) => `${Math.round(n)}`), fps: `${a.fps.toFixed(0)} → ${b.fps.toFixed(0)}`, 'long frames': `${a.longFrames} → ${b.longFrames}` }] : []
      }),
    )
    console.log()
  }
}
