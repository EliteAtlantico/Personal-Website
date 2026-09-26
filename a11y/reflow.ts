// Narrow screens: at 320 px wide (the width WCAG asks pages to work at, a
// small phone or a desktop zoomed to 400%) and at a common phone's 390, no
// page scrolls sideways, and nothing is cut off at the right edge. The front
// page is the phone edition there: its section tabs over panels a screen wide.
import { launch, openPage, ready, serve, sleep } from '../perf/lib'
import { Checks, type Finding } from '../security/checks'

export async function checkReflow(): Promise<Finding[]> {
  const checks = new Checks('Narrow screens')
  const server = await serve()
  const browser = await launch()
  try {
    for (const width of [320, 390]) {
      for (const [view, path] of [['the front page', '/'], ['a story', '/research/brain-freeze'], ['the terminal', '/terminal']] as const) {
        const { page, close } = await openPage(browser, 'mobile')
        try {
          await page.setViewport({ width, height: 800, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
          await page.evaluateOnNewDocument(() => localStorage.setItem('kc:prefs', JSON.stringify({ view: 'paper' })))
          await page.goto(server.url + path, { waitUntil: 'load' })
          await ready(page)
          await sleep(600)
          const over = await page.evaluate(() => {
            const wide = document.documentElement.scrollWidth - document.documentElement.clientWidth
            // The elements that stick out past the right edge (not those scrolled inside their own box, like code).
            const out = [...document.querySelectorAll<HTMLElement>('main *, header *, footer *')]
              .filter((el) => {
                const box = el.getBoundingClientRect()
                if (box.width === 0 || box.right <= innerWidth + 1) return false
                for (let up = el.parentElement; up; up = up.parentElement) if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(up).overflowX)) return false
                return true
              })
              .slice(0, 4)
              .map((el) => `${el.tagName.toLowerCase()}.${(typeof el.className === 'string' ? el.className : '').split(' ')[0]} (${Math.round(el.getBoundingClientRect().right)} px)`)
            return { wide, out }
          })
          checks.expect(`nothing scrolls sideways at ${width} px (${view})`, over.wide <= 1 && !over.out.length, 'medium', `${over.wide} px too wide; ${over.out.join(', ')}`)
          if (path === '/') {
            const edition = await page.evaluate(() => {
              const tabs = document.querySelector<HTMLElement>('.tabs')
              const panels = [...document.querySelectorAll<HTMLElement>('.pager__panel')]
              return { tabs: !!tabs && getComputedStyle(tabs).display !== 'none', panels: panels.length, wide: panels.filter((p) => Math.abs(p.offsetWidth - innerWidth) > 1).length }
            })
            checks.expect(`the front page is the phone edition at ${width} px: its tabs over panels a screen wide`, edition.tabs && edition.panels > 1 && !edition.wide, 'medium', JSON.stringify(edition))
          }
        } finally {
          await close()
        }
      }
    }
  } finally {
    await browser.close()
    server.close()
  }
  return checks.findings
}
