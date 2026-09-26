// JavaScript off: every page is still complete and readable, as it's
// prerendered (what search engines, reader modes, and anyone who blocks
// scripts get). Each page shows its content with one heading at the top,
// every picture says what it is, and every link on the site goes somewhere.
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { launch, openPage, serve } from '../perf/lib'
import { Checks, type Finding } from '../security/checks'

/** Every page the build wrote: "/", "/terminal", "/research/brain-freeze", and the 404 page. */
function pages(dir = 'dist', base = ''): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name)
    if (statSync(file).isDirectory()) return name === 'assets' || name === 'media' ? [] : pages(file, `${base}/${name}`)
    if (!name.endsWith('.html')) return []
    return [name === 'index.html' ? base || '/' : `${base}/${name.slice(0, -'.html'.length)}`]
  })
}

export async function checkNoJs(): Promise<Finding[]> {
  const checks = new Checks('JavaScript off')
  const server = await serve()
  const browser = await launch()
  const links = new Map<string, string>()
  try {
    const { page, close } = await openPage(browser, 'desktop')
    await page.setJavaScriptEnabled(false)
    const blank: string[] = []
    const headings: string[] = []
    const unlabelled: string[] = []
    const broken: string[] = []
    const all = pages()
    for (const route of all) {
      await page.goto(server.url + (route === '/404' ? '/no-such-page' : route), { waitUntil: 'load' })
      const seen = await page.evaluate(() => {
        const main = document.querySelector('main')
        const box = main?.getBoundingClientRect()
        const text = main instanceof HTMLElement ? main.innerText.replace(/\s+/g, ' ').trim() : ''
        return {
          shown: !!main && getComputedStyle(main).visibility === 'visible' && !!box && box.height > 100,
          words: text.split(' ').filter(Boolean).length,
          h1: [...document.querySelectorAll('h1')].map((h) => h.textContent?.trim() ?? ''),
          // Pictures without an alt (alt="" is fine: that's a picture that's only decoration).
          unlabelled: [...document.querySelectorAll('img:not([alt]), svg[role="img"]:not([aria-label]):not([aria-labelledby])')].map((el) => (el as HTMLImageElement).src || el.outerHTML.slice(0, 60)),
          // Pictures that didn't load (those near the top: the rest are loaded as they're scrolled to).
          broken: [...document.images].filter((img) => img.complete && img.naturalWidth === 0 && img.getBoundingClientRect().top < innerHeight).map((img) => img.currentSrc || img.src),
          // The site's own links, but not those within the page (the skip link's #main).
          links: [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].filter((a) => !a.getAttribute('href')!.startsWith('#')).map((a) => a.href).filter((href) => href.startsWith(location.origin)),
        }
      })
      if (!seen.shown || seen.words < (route === '/404' ? 10 : 40)) blank.push(`${route} (${seen.words} words)`)
      if (seen.h1.length !== 1 || !seen.h1[0]) headings.push(`${route}: ${seen.h1.length} h1`)
      unlabelled.push(...seen.unlabelled.map((src) => `${route}: ${src}`))
      broken.push(...seen.broken.map((src) => `${route}: ${src}`))
      for (const href of seen.links) if (!links.has(href.split('#')[0]!)) links.set(href.split('#')[0]!, route)
    }
    await close()
    checks.expect(`every page shows its content (${all.length} pages)`, !blank.length, 'high', blank.join(', '))
    checks.expect('every page has one main heading', !headings.length, 'medium', headings.join(', '))
    checks.expect('every picture says what it is (alt)', !unlabelled.length, 'medium', unlabelled.slice(0, 5).join(', '))
    checks.expect('every picture at the top of a page loads', !broken.length, 'medium', broken.slice(0, 5).join(', '))

    // Every link on the site, followed.
    const dead: string[] = []
    for (const [href, from] of links) {
      const response = await fetch(href, { redirect: 'follow' })
      if (!response.ok) dead.push(`${new URL(href).pathname} (from ${from}: ${response.status})`)
    }
    checks.expect(`every link on the site goes somewhere (${links.size} addresses)`, !dead.length, 'medium', dead.slice(0, 6).join(', '))

    // The terminal, without its shell: every story is still a link.
    const terminal = await openPage(browser, 'desktop')
    await terminal.page.setJavaScriptEnabled(false)
    await terminal.page.goto(`${server.url}/terminal`, { waitUntil: 'load' })
    const stories = await terminal.page.$$eval('main a[href]', (as) => new Set(as.map((a) => new URL((a as HTMLAnchorElement).href).pathname).filter((p) => p.split('/').length === 3)).size)
    await terminal.close()
    const expected = pages().filter((p) => p.split('/').length === 3).length
    checks.expect('the terminal, without its shell, still links every story', stories >= expected, 'medium', `${stories} of ${expected}`)
  } finally {
    await browser.close()
    server.close()
  }
  return checks.findings
}
