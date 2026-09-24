// Scratch: still renders of the globe in each of its hosts, for comparing two implementations.
import { appears, launch, openPage, ready, serve, sleep, terminalCommand } from './lib'
const out = process.argv[2]!
const server = await serve()
const browser = await launch()
try {
  for (const scheme of ['light', 'dark'] as const) {
    const { page, cdp, close } = await openPage(browser, 'desktop')
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: scheme }] })
    await page.goto(server.url + '/', { waitUntil: 'load' })
    await ready(page)
    await page.$eval('.tile--globe', (el) => el.scrollIntoView({ block: 'center' }))
    await appears(page, '.tile--globe canvas')
    await sleep(1500)
    const tile = await page.$('.tile--globe .globe__stage')
    await tile!.screenshot({ path: `${out}/paper-${scheme}.png` })
    await tile!.dispose()
    if (scheme === 'dark') {
      await page.goto(server.url + '/terminal', { waitUntil: 'load' })
      await ready(page)
      await appears(page, '.t-pane--map canvas')
      await sleep(1500)
      const pane = await page.$('.t-pane--map .globe__stage')
      await pane!.screenshot({ path: `${out}/pane.png` })
      await pane!.dispose()
      await terminalCommand(page, 'globe')
      await appears(page, '.terminal__globe canvas')
      await sleep(1500)
      const full = await page.$('.terminal__globe .globe__stage')
      await full!.screenshot({ path: `${out}/full.png` })
      await full!.dispose()
    }
    await close()
  }
} finally {
  await browser.close()
  server.close()
}
