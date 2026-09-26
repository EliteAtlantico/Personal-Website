// Lighthouse on each view (the front page, a story, the terminal), on a
// laptop and on a phone (throttled like a mid-range one on a slow network):
// accessibility, best practices and SEO should be 100, and performance 90.
// It runs against the build, served here the way Cloudflare serves it.
//
// Performance is measured with WebGL off. Headless Chrome can only draw the
// globe in software, on the CPU (about 5 s of blocking time on the phone,
// against 0 without it), which no visitor's browser does: it has a graphics
// card, or no WebGL at all (and then the globe says in words where the
// stories happened). Everything else is measured as it is.
import lighthouse from 'lighthouse'
import desktop from 'lighthouse/core/config/desktop-config.js'
import puppeteer from 'puppeteer-core'
import { findChrome, launch, serve } from '../perf/lib'
import { Checks, type Finding, type Severity } from '../security/checks'

const VIEWS = [
  ['the front page', '/'],
  ['a story', '/research/brain-freeze'],
  ['the terminal', '/terminal'],
] as const

/** What each category must reach, and how bad it is if it doesn't. */
const BARS: Record<string, { min: number; severity: Severity }> = {
  accessibility: { min: 100, severity: 'medium' },
  'best-practices': { min: 100, severity: 'low' },
  seo: { min: 100, severity: 'low' },
  performance: { min: 90, severity: 'low' },
}

export async function checkLighthouse(): Promise<Finding[]> {
  const checks = new Checks('Lighthouse')
  const server = await serve()
  const browser = await launch()
  const software = await puppeteer.launch({ executablePath: findChrome(), headless: findChrome().endsWith('chrome-headless-shell') ? 'shell' : true, args: ['--disable-3d-apis'] })
  const port = (b: typeof browser) => Number(new URL(b.wsEndpoint()).port)
  try {
    for (const [device, config] of [['laptop', desktop], ['phone', undefined]] as const) {
      for (const [view, path] of VIEWS) {
        // One after the other, never side by side: they'd slow each other down.
        const quality = await lighthouse(server.url + path, { port: port(browser), output: 'json', logLevel: 'error', onlyCategories: ['accessibility', 'best-practices', 'seo'] }, config)
        const timed = await lighthouse(server.url + path, { port: port(software), output: 'json', logLevel: 'error', onlyCategories: ['performance'] }, config)
        const lhr = quality?.lhr && timed?.lhr ? { ...quality.lhr, categories: { ...quality.lhr.categories, ...timed.lhr.categories }, audits: { ...quality.lhr.audits, ...timed.lhr.audits } } : undefined
        if (!lhr) {
          checks.expect(`Lighthouse ran (${view}, ${device})`, false, 'info')
          continue
        }
        for (const [id, bar] of Object.entries(BARS)) {
          const category = lhr.categories[id]
          if (!category) continue
          const score = Math.round((category.score ?? 0) * 100)
          // What cost it points: the audits in this category that didn't pass, with a few of the elements.
          const failed = category.auditRefs
            .filter((ref) => ref.weight > 0 || id === 'performance')
            .map((ref) => lhr.audits[ref.id]!)
            .filter((audit) => audit.score !== null && audit.score < (id === 'performance' ? 0.9 : 1) && audit.scoreDisplayMode !== 'informative' && audit.scoreDisplayMode !== 'notApplicable' && audit.scoreDisplayMode !== 'manual')
            .map((audit) => {
              const items = ((audit.details as { items?: Array<{ node?: { snippet?: string }; url?: string }> } | undefined)?.items ?? []).slice(0, 2)
              const where = items.map((item) => item.node?.snippet?.slice(0, 70) ?? item.url?.slice(-50)).filter(Boolean)
              return `${audit.title}${audit.displayValue ? ` (${audit.displayValue})` : ''}${where.length ? `: ${where.join(' ; ')}` : ''}`
            })
          checks.expect(`${category.title} ${score} (${view}, ${device})`, score >= bar.min, bar.severity, failed.slice(0, 4).join(' | ') || `below ${bar.min}`)
        }
      }
    }
  } finally {
    await browser.close()
    await software.close()
    server.close()
  }
  return checks.findings
}
