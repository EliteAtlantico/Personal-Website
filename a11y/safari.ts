// Safari: the pages in macOS's own WebKit (a11y/webkit.swift), where layout can
// differ from Chrome's. In Safari the lead story's columns once spilled over
// the rail after a resize, so every view is checked for text sticking out of
// its column: at common widths, after the window is resized, zoomed in, and
// with Safari's minimum font size set. At a phone's width, the phone edition's
// tabs and its text trailing the scroll are tried too. Needs macOS and Swift
// (the Command Line Tools); anywhere else it says so and moves on.
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { serve } from '../perf/lib'
import { Checks, type Finding } from '../security/checks'

/** Text sticking out past the side of its column (its nearest grid cell), and not clipped away. */
const OVERFLOW = `(() => {
  const main = document.querySelector('main') || document.body
  const cellOf = (el) => { for (let p = el; p && p !== document.body; p = p.parentElement) if (p.parentElement && /grid/.test(getComputedStyle(p.parentElement).display)) return p; return null }
  const clipOf = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (getComputedStyle(p).overflowX !== 'visible') return p.getBoundingClientRect(); return null }
  const hidden = (el) => { for (let p = el; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); if ((s.clip && s.clip !== 'auto') || (s.clipPath && s.clipPath !== 'none') || s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return true } return false }
  const found = new Map()
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement
    if (!n.textContent.trim() || !el || hidden(el)) continue
    const cell = cellOf(el)
    if (!cell) continue
    const c = cell.getBoundingClientRect()
    const clip = clipOf(el)
    const range = document.createRange()
    range.selectNodeContents(n)
    for (const box of range.getClientRects()) {
      if (box.width < 1 || (clip && (box.left >= clip.right - 1 || box.right <= clip.left + 1))) continue
      const over = Math.max(box.right - c.right, c.left - box.left)
      if (over > 2 && !(found.get(el)?.over >= over)) found.set(el, { text: n.textContent.trim().slice(0, 50), over: Math.round(over) })
    }
  }
  return JSON.stringify([...found.values()].sort((a, b) => b.over - a.over).slice(0, 3))
})()`

/** Brings a selector's element to the middle of the window (the globe draws and places its labels only when seen). */
const reveal = (selector: string) => `(() => { document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: 'center' }); return '1' })()`

interface Stuck {
  text: string
  over: number
}

/** The driver, built once per version of webkit.swift (in the temp folder). */
function driver(): string | null {
  if (process.platform !== 'darwin' || spawnSync('xcrun', ['--find', 'swiftc'], { stdio: 'ignore' }).status !== 0) return null
  const source = path.resolve('a11y/webkit.swift')
  const binary = path.join(os.tmpdir(), `kc-webkit-${createHash('sha256').update(readFileSync(source)).digest('hex').slice(0, 12)}`)
  if (!existsSync(binary)) {
    const built = spawnSync('xcrun', ['swiftc', '-O', source, '-o', binary], { encoding: 'utf8' })
    if (built.status !== 0) throw new Error(`couldn't build a11y/webkit.swift:\n${built.stderr}`)
  }
  return binary
}

/** Runs a plan; returns each script's result, in order. Async, so the server here keeps answering meanwhile. */
function drive(binary: string, steps: string[], options: string[] = []): Promise<unknown[]> {
  const file = path.join(os.tmpdir(), `kc-webkit-plan-${process.pid}-${Math.random().toString(36).slice(2)}.txt`)
  writeFileSync(file, steps.join('\n'))
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [file, ...options], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d: Buffer) => (out += d))
    child.on('error', reject)
    child.on('close', () => {
      const results: unknown[] = []
      for (const line of out.split('\n').filter(Boolean)) {
        const parsed = JSON.parse(line) as { result?: unknown; error?: string }
        if (parsed.error) return reject(new Error(parsed.error))
        results.push(parsed.result)
      }
      resolve(results)
    })
  })
}

export async function checkSafari(): Promise<Finding[]> {
  const checks = new Checks('Safari (WebKit)')
  const binary = driver()
  if (!binary) {
    checks.expect('WebKit could be driven (it needs macOS and Swift)', false, 'info')
    return checks.findings
  }
  const js = (code: string) => {
    const file = path.join(os.tmpdir(), `kc-webkit-${createHash('sha256').update(code).digest('hex').slice(0, 10)}.js`)
    writeFileSync(file, code)
    return `js ${file}`
  }
  const server = await serve()
  const check = js(OVERFLOW)
  const describe = (stuck: Stuck[]) => stuck.map((s) => `"${s.text}" sticks out ${s.over} px`).join(' | ')
  // The driver already reads each result as JSON.
  const parse = (result: unknown) => (typeof result === 'string' ? JSON.parse(result) : result ?? []) as Stuck[]

  try {
    // --- The front page, loaded at each width ---
    for (const width of [1728, 1440, 1280, 1100, 1024, 900]) {
      const [stuck] = (await drive(binary, [`size ${width} 900`, `open ${server.url}/`, 'wait 4', check])).map(parse)
      checks.expect(`nothing sticks out of its column on the front page at ${width} px`, !stuck!.length, 'medium', describe(stuck!))
    }

    // --- Resized after it's laid out, both ways, and zoomed in. The globe out of view keeps still (and
    // its labels where they were) until it's seen again, so it's brought into view before looking. ---
    {
      const globe = js(reveal('[data-globe]'))
      const [, narrower, , wider] = (await drive(binary, [`open ${server.url}/`, 'wait 4', 'size 1100 900', 'wait 1', globe, 'wait 1', check, 'size 1600 900', 'wait 1', globe, 'wait 1', check])).map(parse)
      checks.expect('nothing sticks out after the window is made narrower (1440 to 1100 px)', !narrower!.length, 'medium', describe(narrower!))
      checks.expect('nothing sticks out after the window is made wider (1100 to 1600 px)', !wider!.length, 'medium', describe(wider!))
      const [, zoomed] = (await drive(binary, [`open ${server.url}/`, 'wait 4', 'zoom 1.25', 'wait 1', globe, 'wait 1', check])).map(parse)
      checks.expect('nothing sticks out zoomed in to 125%', !zoomed!.length, 'medium', describe(zoomed!))
    }

    // --- The phone edition, at a phone's width: nothing sticks out; a tab shows its panel; the text trails a scroll, then settles ---
    {
      const choose = js(`(() => { document.querySelector('.tabs__tab[data-panel="about"]').click(); return '1' })()`)
      const shown = js(`(() => {
        const tab = document.querySelector('.tabs__tab[aria-selected="true"]')
        const panel = document.getElementById(tab.getAttribute('aria-controls'))
        const pager = document.querySelector('.pager')
        return JSON.stringify({ tab: tab.textContent, inert: panel.inert, left: Math.round(panel.getBoundingClientRect().left - pager.getBoundingClientRect().left), fits: Math.abs(pager.offsetHeight - panel.offsetHeight) < 2 })
      })()`)
      const back = js(`(() => { document.querySelector('.tabs__tab[data-panel="top"]').click(); return '1' })()`)
      // Where the text sits on the page at rest, then a scroll: anything not there mid-scroll is trailing it.
      const flick = js(`(() => {
        window.__text = [...document.querySelectorAll('.pager__panel:not([inert]) :is(p, h2, h3, .drift-line)')].filter((el) => el.getClientRects().length)
        window.__at = () => window.__text.map((el) => el.getBoundingClientRect().top + scrollY)
        window.__rest = window.__at()
        let n = 0
        const go = () => { scrollBy(0, 16); if (++n < 12) requestAnimationFrame(go) }
        requestAnimationFrame(go)
        return '1'
      })()`)
      const trailing = js(`(() => String(window.__at().filter((top, i) => Math.abs(top - window.__rest[i]) > 0.5).length))()`)
      const [stuck, , tab, , , during, after] = await drive(binary, ['size 390 844', `open ${server.url}/`, 'wait 4', check, choose, 'wait 1.5', shown, back, 'wait 1.5', flick, 'wait 0.12', trailing, 'wait 1.5', trailing])
      checks.expect('nothing sticks out of its column on the phone edition (390 px)', !parse(stuck).length, 'medium', describe(parse(stuck)))
      const t = (typeof tab === 'string' ? JSON.parse(tab) : tab) as { tab: string; inert: boolean; left: number; fits: boolean }
      checks.expect("a tab shows its panel on the phone edition (the pager as tall as it)", t.tab === 'About' && !t.inert && Math.abs(t.left) < 2 && t.fits, 'medium', JSON.stringify(t))
      checks.expect('on the phone edition, the text trails a scroll and then settles', Number(during) > 0 && Number(after) === 0, 'low', `${during} trailing mid-scroll, ${after} still after`)
    }

    // --- Safari's "Never use font sizes smaller than", with the globe's labels in view ---
    for (const size of [12, 16]) {
      const [, stuck] = await drive(binary, [`open ${server.url}/`, 'wait 1', js(reveal('[data-globe]')), 'wait 4', check], [`minfont=${size}`])
      checks.expect(`nothing sticks out with Safari's minimum font size at ${size} px`, !parse(stuck).length, 'medium', describe(parse(stuck)))
    }

    // --- Every other page, at 1440 px and after narrowing to 1100 ---
    const pages = readdirSync('dist', { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.html') && file.includes('/') && statSync(path.join('dist', file)).isFile())
      .map((file) => `/${file.slice(0, -'.html'.length)}`)
    const failing: string[] = []
    for (const page of ['/terminal', ...pages]) {
      const [before, after] = (await drive(binary, [`open ${server.url}${page}`, 'wait 3', check, 'size 1100 900', 'wait 2', check])).map(parse)
      if (before!.length || after!.length) failing.push(`${page}: ${describe([...before!, ...after!])}`)
    }
    checks.expect(`nothing sticks out on any other page, before or after a resize (${pages.length + 1} pages)`, !failing.length, 'medium', failing.slice(0, 4).join(' || '))
  } finally {
    server.close()
  }
  return checks.findings
}
