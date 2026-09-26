// The picture a link to the site shows when it's shared (LinkedIn, iMessage,
// Slack, X): public/og.png, 1200×630. It's the masthead as a newspaper
// nameplate, in the paper's night edition: the name between rules, the
// tagline, and the banner's skyline along the bottom, drawn by the site's own
// code (layout/portrait.ts) at this size.
//
// It needs the built site and a Chrome (perf/lib.ts finds one: puppeteer's
// headless shell, or Playwright's), so it runs here and the picture is
// committed, like the fonts: `bun run build && bun run og`, then build again
// to ship it. Run it again when the name, tagline or desks change.
import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { launch, serve } from '../perf/lib'

const OUT = 'public/og.png'
const WIDTH = 1200
const HEIGHT = 630
/** The margin around the type. The skyline runs edge to edge along the bottom. */
const MARGIN = 56
const BANNER = { width: WIDTH, height: 322 }
/** The banner's sky is a faint texture of letters (layout/portrait.ts draws it at 16% on the night paper); here, fainter still, so the city reads first. */
const SKY = { site: 0.16, here: 0.06 }

const config = JSON.parse(readFileSync('content/site.json', 'utf8')) as { author: string; tagline: string; edition: string; desks: Array<{ name: string }> }

const server = await serve()
const browser = await launch()
try {
  const page = await browser.newPage()
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 })
  // The night edition, drawn in one go (no intro), and the paper rather than the terminal.
  await page.emulateMediaFeatures([
    { name: 'prefers-color-scheme', value: 'dark' },
    { name: 'prefers-reduced-motion', value: 'reduce' },
  ])
  await page.evaluateOnNewDocument(
    (banner, sky) => {
      localStorage.setItem('kc:prefs', JSON.stringify({ view: 'paper', personalize: false }))
      // The banner at the picture's size, before the site lays it out.
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style')
        style.textContent = `.masthead__banner { width: ${banner.width}px !important; height: ${banner.height}px !important; }`
        document.head.append(style)
      })
      // The sky's letters, fainter: the banner sets exactly this alpha for them and nothing else.
      const alpha = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'globalAlpha')!
      Object.defineProperty(CanvasRenderingContext2D.prototype, 'globalAlpha', {
        get() {
          return alpha.get!.call(this)
        },
        set(value: number) {
          alpha.set!.call(this, value === sky.site ? sky.here : value)
        },
      })
    },
    BANNER,
    SKY,
  )
  await page.goto(`${server.url}/`, { waitUntil: 'load' })

  // Wait for the skyline's letters, then take them.
  const skyline = await page.waitForFunction(
    () => {
      const canvas = document.querySelector<HTMLCanvasElement>('.masthead__banner canvas')
      if (!canvas?.width) return null
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      let inked = 0
      for (let i = 3; i < pixels.length; i += 4 * 97) if (pixels[i]! > 0) inked++
      return inked > 200 ? canvas.toDataURL('image/png') : null
    },
    { timeout: 20_000, polling: 250 },
  )
  const banner = (await skyline.jsonValue()) as string
  await skyline.dispose()

  // The nameplate, in the site's own type and colours (its stylesheet and fonts are loaded).
  await page.evaluate(
    ({ banner, config, size }) => {
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
      const dot = '<span class="og__dot">\u00b7</span>'
      document.body.className = ''
      document.body.innerHTML = `
        <style>
          html, body { margin: 0; background: var(--paper); }
          .og { position: relative; box-sizing: border-box; width: ${size.width}px; height: ${size.height}px; padding: 38px ${size.margin}px 0; background: var(--paper); color: var(--ink); overflow: hidden; }
          .og__strip { display: flex; justify-content: space-between; padding-bottom: 12px; border-bottom: 1px solid var(--rule-strong); font: 500 15px/1 var(--font-mono); letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-3); }
          .og__name { margin: 30px 0 0; font: 650 124px/0.92 var(--font-display); letter-spacing: -0.02em; text-align: center; white-space: nowrap; }
          .og__tagline { margin: 26px 0 0; padding: 13px 0 12px; border-top: 3px double var(--rule-strong); border-bottom: 1px solid var(--rule-strong); font: 500 20px/1.2 var(--font-mono); letter-spacing: 0.14em; text-transform: uppercase; text-align: center; color: var(--ink-2); }
          .og__dot { color: var(--accent); }
          /* Along the bottom, edge to edge, the tower rising to the tagline. */
          .og__banner { position: absolute; left: 0; bottom: 0; display: block; width: ${size.width}px; height: ${size.banner}px; }
        </style>
        <main class="og">
          <div class="og__strip"><span>${esc(config.edition)}</span><span>${config.desks.map((d) => esc(d.name)).join(' \u00b7 ')}</span></div>
          <h1 class="og__name">${esc(config.author)}</h1>
          <p class="og__tagline">${esc(config.tagline).replace(' \u00b7 ', ` ${dot} `)}</p>
          <img class="og__banner" src="${banner}" alt="">
        </main>`
    },
    { banner, config, size: { width: WIDTH, height: HEIGHT, margin: MARGIN, banner: BANNER.height } },
  )
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  const shot = await page.screenshot({ clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT }, type: 'png' })
  // Taken at twice the size and scaled down: finer edges on the skyline's letters.
  const png = await sharp(Buffer.from(shot)).resize(WIDTH, HEIGHT, { kernel: 'lanczos3' }).png({ palette: true, quality: 95, effort: 10, compressionLevel: 9 }).toFile(OUT)
  console.log(`${OUT}: ${png.width}×${png.height}, ${(png.size / 1024).toFixed(0)} KB`)
} finally {
  await browser.close()
  server.close()
}
