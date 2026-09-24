// Attacks on the pages, in a real browser: script injection (XSS) through
// everything a visitor or a link can control (the address, ?debug, what
// Cloudflare says about a visitor, the referrer, localStorage, the
// terminal's prompt), framing (clickjacking), and requests to other sites.
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Browser, Page } from 'puppeteer-core'
import { appears, launch, openPage, ready, serve, sleep, terminalCommand } from '../perf/lib'
import { Checks, type Finding } from './checks'

/** Each sets window.__pwn if it runs, and leaves an element with an on* attribute if it's injected at all. */
const PAYLOADS = [`"><img src=x onerror="window.__pwn='img'">`, `<svg/onload=window.__pwn='svg'>`, `</script><script>window.__pwn='script'</script>`, `javascript:window.__pwn='href'`, `'><iframe srcdoc="<script>parent.__pwn='srcdoc'</script>">`]

/** Page-side watch: runs before the page's own code. */
const WATCH = () => {
  const w = window as unknown as { __violations: string[] }
  w.__violations = []
  document.addEventListener('securitypolicyviolation', (e) => w.__violations.push(`${e.violatedDirective} ${e.blockedURI}`))
}

async function verdict(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { __pwn?: string; __violations: string[] }
    // The site never writes on* attributes itself; any element that has one was injected.
    const injected = [...document.querySelectorAll('*')].filter((el) => [...el.attributes].some((a) => /^on/i.test(a.name))).map((el) => el.outerHTML.slice(0, 80))
    const scripted = [...document.querySelectorAll('a[href^="javascript:" i], iframe[srcdoc]')].map((el) => el.outerHTML.slice(0, 80))
    return { ran: w.__pwn, injected: [...injected, ...scripted], violations: w.__violations }
  })
}

export async function attackBrowser(): Promise<Finding[]> {
  const checks = new Checks('Pages (in a browser)')
  const server = await serve()
  const browser = await launch()
  const external = new Set<string>()
  const dialogs: string[] = []
  try {
    const visit = async (label: string, go: (page: Page) => Promise<void>, { visitor }: { visitor?: Record<string, string> } = {}) => {
      const opened = await openPage(browser, 'desktop')
      const { page } = opened
      await page.evaluateOnNewDocument(WATCH)
      page.on('dialog', (d) => {
        dialogs.push(`${label}: ${d.message()}`)
        void d.dismiss()
      })
      await page.setRequestInterception(true)
      page.on('request', (request) => {
        const url = new URL(request.url())
        if (url.origin !== server.url && !url.protocol.startsWith('data') && !url.protocol.startsWith('blob')) external.add(`${label}: ${url.origin}`)
        // What Cloudflare says about the visitor is theirs to control (their network's name, say).
        if (visitor && url.pathname === '/api/visitor') return void request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(visitor) })
        void request.continue()
      })
      try {
        await go(page)
        const found = await verdict(page)
        checks.expect(`no script runs: ${label}`, !found.ran, 'high', found.ran ? `payload ran (${found.ran})` : undefined)
        checks.expect(`no HTML is injected: ${label}`, !found.injected.length, 'high', found.injected.join(' | '))
        checks.expect(`nothing breaks the content security policy: ${label}`, !found.violations.length, 'low', found.violations.join(' | '))
      } catch (error) {
        checks.expect(`${label} could be tested`, false, 'info', (error as Error).message)
      } finally {
        await opened.close()
      }
    }

    const all = (p: string) => new URLSearchParams({ debug: '', org: p, city: p, country: p, os: p, browser: p, version: p, tz: p, gpu: p, fonts: p, lang: p, ref: p, via: p }).toString()
    for (const [i, payload] of PAYLOADS.entries()) {
      const tag = `payload ${i + 1}`
      // ?debug on the front page, then the panel that lists every signal.
      await visit(`?debug values on the front page and its panel (${tag})`, async (page) => {
        await page.goto(`${server.url}/?${all(payload)}&view=paper`, { waitUntil: 'load' })
        await ready(page)
        const panel = await page.$('[data-note="panel"]')
        if (panel) {
          await panel.click()
          await panel.dispose()
          await appears(page, 'dialog.signals[open]', 5000).catch(() => undefined)
        }
        await sleep(300)
      })
      // What Cloudflare says, in the note, the panel, and the terminal's whoami.
      await visit(`Cloudflare's visitor data (${tag})`, async (page) => {
        await page.goto(`${server.url}/terminal`, { waitUntil: 'load' })
        await ready(page)
        await terminalCommand(page, 'whoami')
        await sleep(300)
      }, { visitor: { city: payload, region: payload, country: payload, org: payload } })
      // ?debug in the terminal.
      await visit(`?debug values in the terminal (${tag})`, async (page) => {
        await page.goto(`${server.url}/terminal?${all(payload)}`, { waitUntil: 'load' })
        await ready(page)
        await terminalCommand(page, 'whoami')
        await terminalCommand(page, 'personalize')
        await sleep(300)
      })
      // Typed into the prompt.
      await visit(`commands typed into the terminal (${tag})`, async (page) => {
        await page.goto(`${server.url}/terminal`, { waitUntil: 'load' })
        await ready(page)
        for (const command of [payload, `cat ${payload}`, `cd ${payload}`, `open ${payload}`, `grep ${payload}`, `ls ${payload}`, `man ${payload}`, `view ${payload}`, `personalize ${payload}`]) await terminalCommand(page, command)
        // A second dashboard turns the first one's rain and globe into pictures (blob: images, under the policy).
        await terminalCommand(page, 'dashboard')
        await sleep(1500)
        // Tab completion of it too.
        await page.focus('#terminal-input')
        await page.keyboard.type(`cat ${payload}`)
        await page.keyboard.press('Tab')
        await sleep(300)
      })
      // In the address.
      await visit(`addresses (${tag})`, async (page) => {
        for (const path of [`/${encodeURIComponent(payload)}`, `/research/${encodeURIComponent(payload)}`, `/?x=${encodeURIComponent(payload)}#${encodeURIComponent(payload)}`]) {
          await page.goto(server.url + path, { waitUntil: 'load' })
          await ready(page).catch(() => undefined)
        }
      })
      // A crafted referrer (whoami and the panel name the site a visitor came from).
      await visit(`the referrer (${tag})`, async (page) => {
        await page.goto(`${server.url}/terminal`, { waitUntil: 'load', referer: `https://github.com/${payload}` })
        await ready(page)
        await terminalCommand(page, 'whoami')
        await sleep(300)
      })
    }

    // Whatever localStorage holds (another script on the same device could have written it).
    await visit('odd values in localStorage', async (page) => {
      await page.goto(`${server.url}/`, { waitUntil: 'load' })
      await page.evaluate((p) => localStorage.setItem('kc:prefs', JSON.stringify({ view: p, personalize: p })), PAYLOADS[0]!)
      await page.reload({ waitUntil: 'load' })
      await ready(page)
      await page.evaluate(() => localStorage.setItem('kc:prefs', '{not json'))
      await page.reload({ waitUntil: 'load' })
      await ready(page)
    })

    // A link can't put a message of its own on the page (?debug and Cloudflare's names are shown in the note).
    const spoof = await openPage(browser, 'desktop')
    try {
      const message = 'Log in at evil.example to unlock your account'
      await spoof.page.goto(`${server.url}/?debug&org=${encodeURIComponent(message)}&city=${encodeURIComponent(message)}&view=paper`, { waitUntil: 'load' })
      await ready(spoof.page)
      const shown = await spoof.page.evaluate(() => document.body.innerText)
      checks.expect("a link can't put a web address of its own on the page", !shown.includes('evil.example'), 'low', shown.includes('evil.example') ? 'the note shows the address from the link' : undefined)
    } finally {
      await spoof.close()
    }

    // An address with a broken escape in it (anyone can link to one): the page must still start.
    const broken = await openPage(browser, 'desktop')
    try {
      const errors: string[] = []
      broken.page.on('pageerror', (e) => errors.push(String(e)))
      await broken.page.goto(`${server.url}/research/%E0%A4%A`, { waitUntil: 'load' })
      const started = await ready(broken.page, 6000).then(() => true, () => false)
      checks.expect('a broken escape in the address doesn\'t stop the page from starting', started && !errors.length, 'low', errors.join(' | ') || (started ? undefined : 'the page never finished loading'))
    } finally {
      await broken.close()
    }

    checks.expect('no dialog was opened by injected script', !dialogs.length, 'high', dialogs.join(' | '))
    checks.expect('pages make no requests to other sites', !external.size, 'low', [...external].slice(0, 5).join(' | '))

    // --- Clickjacking: another site framing this one ---
    const framer = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html')
      res.end(`<iframe src="${server.url}/" width="800" height="600"></iframe>`)
    })
    await new Promise<void>((resolve) => framer.listen(0, '127.0.0.1', resolve))
    const opened = await openPage(browser, 'desktop')
    try {
      const refused: string[] = []
      opened.page.on('console', (m) => /Refused to (display|frame)/i.test(m.text()) && refused.push(m.text()))
      await opened.page.goto(`http://127.0.0.1:${(framer.address() as AddressInfo).port}/`, { waitUntil: 'load' })
      await sleep(1000)
      const child = opened.page.frames().find((f) => f !== opened.page.mainFrame())
      const shown = child ? await child.evaluate(() => !!document.querySelector('.page')).catch(() => false) : false
      checks.expect('other sites cannot frame the site (clickjacking)', !shown, 'medium', shown ? 'the site rendered inside another site\'s iframe' : undefined)
    } finally {
      await opened.close()
      framer.close()
    }

    // --- Links that open a new tab can't reach back (reverse tabnabbing) ---
    const pages = await openPage(browser, 'desktop')
    try {
      const unsafe: string[] = []
      for (const path of ['/', '/terminal', '/research/brain-freeze', '/projects/butler-bot']) {
        await pages.page.goto(server.url + path, { waitUntil: 'load' })
        await ready(pages.page).catch(() => undefined)
        unsafe.push(...(await pages.page.$$eval('a[target="_blank"]', (links) => links.filter((a) => !/noopener|noreferrer/.test(a.getAttribute('rel') ?? '')).map((a) => a.getAttribute('href') ?? ''))))
      }
      checks.expect('links opening a new tab use rel="noopener"', !unsafe.length, 'low', unsafe.slice(0, 5).join(', '))
    } finally {
      await pages.close()
    }
  } finally {
    await browser.close()
    server.close()
  }
  return checks.findings
}

export type { Browser }
