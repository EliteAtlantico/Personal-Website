// The typographic portrait: the masthead banner photo, redrawn out of the words
// of every story on the front page, flowed by pretext in justified rows.
//  - The strip shows a slice of the photo (site.json banner.band), squeezed
//    vertically so a whole skyline fits in a thin banner.
//  - mode "silhouette": the city's skyline is found in the photo (./skyline).
//    Letters below it are dense ink, clipped exactly to the rooftops; the sky
//    is a faint hairline texture.
//  - mode "tone": each letter's weight and opacity follow the photo's brightness.
//  - A landmark (banner.landmark, e.g. the CN Tower) is a traced outline, set in
//    heavy accent-coloured letters. On load it builds itself last, upward from
//    the ground.
//  - Letters swarm in at the same pace as the bio's snowfall (./pace); the
//    cursor pushes them aside.
// The <img> stays in the page for its alt text and for visitors without
// JavaScript; the canvas on top is decoration.
import { layoutNextLine, type LayoutCursor } from '@chenglou/pretext'
import { FAMILY, canvasFont, type FontSpec } from './fonts'
import { onWidth } from './observe'
import { intro } from './pace'
import { findSkyline } from './skyline'
import { prep } from './text'

const LEVELS = 14
const PUSH_RADIUS = 70
const START: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
const SOFT_HYPHEN = String.fromCharCode(0xad)
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** A rectangle of the banner, in CSS pixels. */
interface Area {
  left: number
  top: number
  right: number
  bottom: number
}

/** Stamps of every letter in one weight and colour (see `sheet` in build). */
interface Sheet {
  canvas: HTMLCanvasElement
  /** Each letter's place on the sheet. */
  at: Map<string, number>
  /** Size of a stamp, and the room around the letter inside it, in device pixels. */
  cell: number
  inset: number
  columns: number
}

interface Glyph {
  ch: string
  /** Home position (top left) and advance width. */
  hx: number
  hy: number
  w: number
  /** Offset from home (intro / cursor). */
  dx: number
  dy: number
  level: number
  delay: number
  dur: number
  ox: number
  oy: number
  /** Lives in the landmark's column: it arrives in the finale, and only these letters are drawn in its colour. */
  tower: boolean
}

export function layoutPortrait(page: HTMLElement, signal: AbortSignal) {
  const figure = page.querySelector<HTMLElement>('.masthead__banner')
  const img = figure?.querySelector('img')
  if (!figure || !img) return
  // Can't typeset it: show the photo itself (and the canvas steps aside, so it isn't described twice).
  const showPhoto = () => {
    figure.classList.add('is-photo')
    figure.querySelector('.masthead__portrait')?.remove()
  }
  const start = () => {
    try {
      if (!build(page, figure, img, signal)) showPhoto()
    } catch (error) {
      showPhoto()
      throw error
    }
  }
  // A silhouette whose skyline was found when the site was built needs nothing from the photo.
  if (figure.dataset.skyline || (img.complete && img.naturalWidth)) start()
  else img.addEventListener('load', start, { once: true, signal })
}

/** The skyline content/load.ts found in the photo: its sampling size, and the rooftop row of each column. */
export function readSkyline(value: string | undefined) {
  const match = /^(\d+)x(\d+):(-?\d+(?:,-?\d+)*)$/.exec(value ?? '')
  if (!match) return null
  const width = Number(match[1])
  const rows = new Int16Array(width)
  let row = 0
  match[3]!.split(',').forEach((change, x) => {
    if (x < width) rows[x] = row = x ? row + Number(change) : Number(change)
  })
  return { width, height: Number(match[2]), rows }
}

/** The photo, downscaled once, for its skyline (silhouette mode) or its brightness (tone mode). */
function samplePhoto(img: HTMLImageElement, silhouette: boolean, band: [number, number]) {
  const width = Math.min(img.naturalWidth, 1200)
  const height = Math.max(1, Math.round((img.naturalHeight * width) / img.naturalWidth))
  const sampler = document.createElement('canvas')
  sampler.width = width
  sampler.height = height
  const sctx = sampler.getContext('2d', { willReadFrequently: true })!
  sctx.drawImage(img, 0, 0, width, height)
  const pixels = sctx.getImageData(0, 0, width, height).data
  sampler.width = sampler.height = 0
  const rgb = (x: number, y: number): [number, number, number] => {
    const i = (Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * 4
    return [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!]
  }
  const brightness = (fx: number, fy: number) => {
    const [r, g, b] = rgb(Math.round(fx * width), Math.round(fy * height))
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  }
  return { width, height, rows: silhouette ? findSkyline(rgb, width, height, band) : null, brightness }
}

/** Draws the portrait; false if there's nothing to draw it with. */
function build(page: HTMLElement, figure: HTMLElement, img: HTMLImageElement, signal: AbortSignal): boolean {
  // The words of the stories on this page, in page order.
  const text = [...page.querySelectorAll<HTMLElement>('.tile__headline, .tile__dek, .bio__text')]
    .map((el) => (el.dataset.text ?? el.textContent ?? '').replaceAll(SOFT_HYPHEN, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('  ·  ')
  if (!text) return false

  const [bandTop = 0, bandBottom = 1] = (figure.dataset.band ?? '0,1').split(',').map(Number)
  const outline = figure.dataset.landmark ? (JSON.parse(figure.dataset.landmark) as Array<[number, number]>) : []

  const canvas = figure.querySelector('canvas') ?? figure.appendChild(document.createElement('canvas'))
  canvas.className = 'masthead__portrait'
  // The canvas stands in for the photo (which may never load), so it carries the photo's description.
  canvas.setAttribute('role', 'img')
  canvas.setAttribute('aria-label', img.alt)
  const ctx = canvas.getContext('2d')
  if (!ctx) return false
  const motion = !matchMedia('(prefers-reduced-motion: reduce)').matches
  const dark = matchMedia('(prefers-color-scheme: dark)')

  // The rooftops (a row of the sampled photo) for each column of it: found when the site was built,
  // or else here, in the photo. Tone mode reads the photo's brightness too.
  const photo = readSkyline(figure.dataset.skyline) ?? samplePhoto(img, figure.dataset.mode === 'silhouette', [bandTop, bandBottom])
  const { width: sampleW, height: sampleH } = photo
  const skyline = photo.rows
  const brightness = 'brightness' in photo ? photo.brightness : () => 0.5

  let glyphs: Glyph[] = []
  let buckets: Glyph[][] = []
  let size = { w: 0, h: 0 }
  let font: FontSpec = { family: FAMILY.text, weight: 400, size: 10 }
  let ink = ''
  let accent = ''
  /** Silhouette mode: the rooftops' y for each strip column, and the city below them. */
  let roofs: Float32Array | null = null
  let city: Path2D | null = null
  /** The landmark's outline, the strip with the landmark cut out, and its horizontal extent. */
  let landmark: Path2D | null = null
  let aroundLandmark: Path2D | null = null
  let span = { left: 0, right: 0 }
  let introStart = 0
  let introEnd = 0
  /** When the finale (the landmark rising) starts, in ms into the intro. */
  let finaleAt = 0
  let pointer: { x: number; y: number } | null = null
  let frame = 0
  /** Device pixels per CSS pixel, and the letter stamps for this size and these colours. */
  let dpr = 1
  let sheets = new Map<string, Sheet>()

  // Photo fractions → strip pixels (the band is squeezed to the strip's height).
  const stripY = (fy: number) => ((fy - bandTop) / (bandBottom - bandTop)) * size.h
  const photoY = (y: number) => bandTop + (y / size.h) * (bandBottom - bandTop)
  const inSpan = (g: Glyph, x: number) => x + g.w > span.left && x < span.right

  const layout = () => {
    const w = figure.clientWidth
    const h = figure.clientHeight
    if (!w || !h) return
    size = { w, h }
    ink = getComputedStyle(figure).color
    accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || ink
    dpr = Math.min(2, window.devicePixelRatio || 1)
    for (const { canvas: stamps } of sheets.values()) stamps.width = stamps.height = 0
    sheets = new Map()
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // Small enough for at least ~9 rows, however thin the strip is.
    font = { family: FAMILY.text, weight: 400, size: Math.max(5, Math.min(10, w / 150, h / 9 / 1.12)) }
    const lineHeight = font.size * 1.12
    const rows = Math.floor(h / lineHeight)
    const top = (h - rows * lineHeight) / 2
    ctx.font = canvasFont(font)
    const widths = new Map<string, number>()
    const width = (ch: string) => widths.get(ch) ?? widths.set(ch, ctx.measureText(ch).width).get(ch)!

    // The stories, flowed row by row across the strip.
    const prepared = prep(text, font)
    let cursor = START
    glyphs = []
    for (let row = 0; row < rows; row++) {
      let line = layoutNextLine(prepared, cursor, w)
      if (!line) {
        cursor = START
        line = layoutNextLine(prepared, cursor, w)
        if (!line) break
      }
      cursor = line.end
      const chars = [...segmenter.segment(line.text.trimEnd())].map((s) => s.segment)
      const natural = chars.reduce((sum, ch) => sum + width(ch), 0)
      const spaces = chars.filter((ch) => ch === ' ').length
      const extra = spaces ? Math.min(font.size, (w - natural) / spaces) : 0
      const y = top + row * lineHeight
      let x = 0
      for (const ch of chars) {
        if (ch !== ' ') glyphs.push({ ch, hx: x, hy: y, w: width(ch), dx: 0, dy: 0, level: 0, delay: 0, dur: 0, ox: 0, oy: 0, tower: false })
        x += width(ch) + (ch === ' ' ? extra : 0)
      }
    }

    // The landmark, in strip pixels.
    landmark = aroundLandmark = null
    if (outline.length > 2) {
      const path = new Path2D()
      for (const [i, [fx, fy]] of outline.entries()) {
        if (i) path.lineTo(fx * w, stripY(fy))
        else path.moveTo(fx * w, stripY(fy))
      }
      path.closePath()
      landmark = path
      // Even-odd: the whole strip, with the landmark as a hole.
      aroundLandmark = new Path2D()
      aroundLandmark.rect(0, 0, w, h)
      aroundLandmark.addPath(path)
      const xs = outline.map(([fx]) => fx * w)
      span = { left: Math.min(...xs), right: Math.max(...xs) }
    }
    for (const g of glyphs) g.tower = !!landmark && inSpan(g, g.hx)

    roofs = city = null
    if (skyline) {
      const tops = new Float32Array(w + 1)
      for (let x = 0; x <= w; x++) {
        // The highest rooftop among the photo columns this strip column covers, so thin spires survive.
        const from = Math.min(sampleW - 1, Math.floor((x / w) * sampleW))
        const to = Math.max(from + 1, Math.min(sampleW, Math.floor(((x + 1) / w) * sampleW)))
        let roof = sampleH
        for (let sx = from; sx < to; sx++) roof = Math.min(roof, skyline[sx]!)
        tops[x] = stripY(roof / sampleH)
      }
      // The landmark is drawn on its own, so take its spike out of the skyline:
      // across its width the rooftops run straight between its neighbours.
      if (landmark) {
        const a = Math.max(0, Math.floor(span.left) - 2)
        const b = Math.min(w, Math.ceil(span.right) + 2)
        for (let x = a + 1; x < b; x++) tops[x] = Math.max(tops[x]!, tops[a]! + ((tops[b]! - tops[a]!) * (x - a)) / (b - a))
      }
      const path = new Path2D()
      path.moveTo(0, h)
      for (let x = 0; x <= w; x++) path.lineTo(x, tops[x]!)
      path.lineTo(w, h)
      path.closePath()
      roofs = tops
      city = path
    } else {
      // Tone levels, contrast-stretched to the strip's own brightness range.
      const tone = glyphs.map((g) => brightness((g.hx + g.w / 2) / w, photoY(g.hy + lineHeight / 2)))
      const sorted = [...tone].sort((a, b) => a - b)
      const lo = sorted[Math.floor(sorted.length * 0.03)] ?? 0
      const hi = sorted[Math.floor(sorted.length * 0.97)] ?? 1
      glyphs.forEach((g, i) => {
        const n = Math.max(0, Math.min(1, (tone[i]! - lo) / Math.max(0.01, hi - lo)))
        g.level = Math.round((dark.matches ? n : 1 - n) ** 1.3 * LEVELS)
      })
    }
    buckets = Array.from({ length: LEVELS + 1 }, () => [])
    for (const g of glyphs) buckets[g.level]!.push(g)
    draw()
  }

  /** Smallest / largest rooftop y over the strip columns a glyph covers. */
  const roofTop = (tops: Float32Array, x0: number, x1: number) => {
    let y = Infinity
    for (let x = Math.max(0, Math.floor(x0)), end = Math.min(tops.length - 1, Math.ceil(x1)); x <= end; x++) y = Math.min(y, tops[x]!)
    return y
  }
  const roofBottom = (tops: Float32Array, x0: number, x1: number) => {
    let y = -Infinity
    for (let x = Math.max(0, Math.floor(x0)), end = Math.min(tops.length - 1, Math.ceil(x1)); x <= end; x++) y = Math.max(y, tops[x]!)
    return y
  }

  /**
   * A sheet of stamps: every letter the banner uses, drawn once in one weight
   * and colour at the screen's resolution. fillText lays its text out on every
   * call, and the banner draws thousands of letters a frame; copying a stamp's
   * pixels is many times cheaper, and, copied to whole device pixels, looks
   * exactly the same.
   */
  const sheet = (weight: number, color: string): Sheet => {
    const key = `${weight} ${color}`
    const known = sheets.get(key)
    if (known) return known
    const letters = [...new Set(glyphs.map((g) => g.ch))]
    const px = font.size * dpr
    const cell = Math.ceil(px * 1.6)
    const inset = Math.ceil(px * 0.3)
    const columns = Math.max(1, Math.ceil(Math.sqrt(letters.length)))
    const stamps = document.createElement('canvas')
    stamps.width = columns * cell
    stamps.height = Math.max(1, Math.ceil(letters.length / columns)) * cell
    const sctx = stamps.getContext('2d')!
    sctx.font = canvasFont({ ...font, size: px, weight })
    sctx.textBaseline = 'top'
    sctx.fillStyle = color
    const at = new Map<string, number>()
    letters.forEach((ch, i) => {
      at.set(ch, i)
      sctx.fillText(ch, (i % columns) * cell + inset, Math.floor(i / columns) * cell + inset)
    })
    const made = { canvas: stamps, at, cell, inset, columns }
    sheets.set(key, made)
    return made
  }
  const stamp = (from: Sheet, ch: string, x: number, y: number) => {
    const i = from.at.get(ch)
    if (i === undefined) return
    const { cell, inset, columns } = from
    ctx.drawImage(from.canvas, (i % columns) * cell, Math.floor(i / columns) * cell, cell, cell, (Math.round(x * dpr) - inset) / dpr, (Math.round(y * dpr) - inset) / dpr, cell / dpr, cell / dpr)
  }

  /** Draws the letters (those touching `area`, for a partial redraw, or all of them). */
  const letters = (finale: boolean, area: Area | null) => {
    const touches = (g: Glyph) => {
      if (!area) return true
      const x = g.hx + g.dx
      const y = g.hy + g.dy
      return x - font.size < area.right && x + g.w + font.size > area.left && y - font.size < area.bottom && y + font.size * 2 > area.top
    }
    if (roofs && city) {
      // Sky: a faint hairline texture, wherever a letter shows above the rooftops.
      const sky = sheet(300, ink)
      ctx.globalAlpha = dark.matches ? 0.16 : 0.12
      for (const g of glyphs) {
        if (!touches(g)) continue
        const x = g.hx + g.dx
        const y = g.hy + g.dy
        if (y < roofBottom(roofs, x, x + g.w)) stamp(sky, g.ch, x, y)
      }
      // City: dense ink, clipped exactly to the rooftops (and around the landmark).
      ctx.save()
      ctx.clip(city)
      if (aroundLandmark && finale) ctx.clip(aroundLandmark, 'evenodd')
      const dense = sheet(650, ink)
      ctx.globalAlpha = 0.92
      for (const g of glyphs) {
        if (!touches(g)) continue
        const x = g.hx + g.dx
        const y = g.hy + g.dy
        if (y + font.size > roofTop(roofs, x, x + g.w)) stamp(dense, g.ch, x, y)
      }
      ctx.restore()
    } else {
      for (let level = 0; level <= LEVELS; level++) {
        const tone = level / LEVELS
        // Highlights: hairline and faint. Shadows: heavy and solid.
        const shade = sheet(Math.round(220 + 580 * tone), ink)
        ctx.globalAlpha = 0.07 + 0.93 * tone
        for (const g of buckets[level]!) if (touches(g)) stamp(shade, g.ch, g.hx + g.dx, g.hy + g.dy)
      }
    }
    if (landmark && finale) {
      // The landmark: its own letters, heavy and in the accent colour, clipped exactly to its outline.
      ctx.save()
      ctx.clip(landmark)
      const heavy = sheet(800, accent)
      ctx.globalAlpha = 1
      for (const g of glyphs) if (g.tower && touches(g)) stamp(heavy, g.ch, g.hx + g.dx, g.hy + g.dy)
      ctx.restore()
    }
    ctx.globalAlpha = 1
  }

  /** The whole banner, or only `area` (where letters moved), cleared and drawn again. */
  const draw = (now = performance.now(), area: Area | null = null) => {
    // Until the finale, nothing marks the landmark: letters flying through its outline are
    // drawn like any others, and it only takes its colour as its own letters rise.
    const finale = !introStart || now - introStart >= finaleAt
    if (!area) {
      ctx.clearRect(0, 0, size.w, size.h)
      letters(finale, null)
      return
    }
    // To whole device pixels, so the edge of the redrawn patch doesn't show.
    const left = Math.floor(area.left * dpr) / dpr
    const top = Math.floor(area.top * dpr) / dpr
    const width = Math.ceil(area.right * dpr) / dpr - left
    const height = Math.ceil(area.bottom * dpr) / dpr - top
    ctx.save()
    ctx.beginPath()
    ctx.rect(left, top, width, height)
    ctx.clip()
    ctx.clearRect(left, top, width, height)
    letters(finale, { left, top, right: left + width, bottom: top + height })
    ctx.restore()
  }

  // Frame loop: the intro swarm, then cursor pushes; stops as soon as nothing moves.
  // During the intro everything moves, so everything is drawn; after it, only the
  // patch where letters moved (around the cursor) is.
  let finaleShown = false
  const tick = (now: number) => {
    const intro = introStart > 0 && now - introStart < introEnd
    let busy = intro
    const elapsed = now - introStart
    let moved: Area | null = null
    const include = (g: Glyph, dx: number, dy: number) => {
      const x = g.hx + dx
      const y = g.hy + dy
      moved ??= { left: x, top: y, right: x, bottom: y }
      moved.left = Math.min(moved.left, x - font.size)
      moved.right = Math.max(moved.right, x + g.w + font.size)
      moved.top = Math.min(moved.top, y - font.size)
      moved.bottom = Math.max(moved.bottom, y + font.size * 2)
    }
    for (const g of glyphs) {
      if (introStart && elapsed < g.delay + g.dur) {
        const t = Math.max(0, Math.min(1, (elapsed - g.delay) / g.dur))
        const e = 1 - (1 - t) ** 3
        g.dx = g.ox * (1 - e)
        g.dy = g.oy * (1 - e)
        continue
      }
      const [x0, y0] = [g.dx, g.dy]
      let tx = 0
      let ty = 0
      if (pointer) {
        const cx = g.hx - pointer.x
        const cy = g.hy - pointer.y
        const d = Math.hypot(cx, cy)
        if (d < PUSH_RADIUS && d > 0) {
          const push = (1 - d / PUSH_RADIUS) ** 2 * 26
          tx = (cx / d) * push
          ty = (cy / d) * push
        }
      }
      g.dx += (tx - g.dx) * 0.22
      g.dy += (ty - g.dy) * 0.22
      if (Math.abs(g.dx - tx) > 0.05 || Math.abs(g.dy - ty) > 0.05) busy = true
      else {
        g.dx = tx
        g.dy = ty
      }
      if (g.dx !== x0 || g.dy !== y0) {
        include(g, x0, y0)
        include(g, g.dx, g.dy)
      }
    }
    // The finale changes how the landmark's letters look everywhere, so that frame is drawn whole.
    const finale = !introStart || elapsed >= finaleAt
    const whole = intro || finale !== finaleShown
    finaleShown = finale
    const patch = moved as Area | null
    if (whole || (patch && (patch.right - patch.left) * (patch.bottom - patch.top) > size.w * size.h * 0.5)) draw(now)
    else if (patch) draw(now, patch)
    frame = busy ? requestAnimationFrame(tick) : 0
  }
  const animate = () => {
    if (!frame) frame = requestAnimationFrame(tick)
  }

  // The same pace as the bio's snowfall (see pace.ts), sweeping in from the left.
  // The landmark's column comes last, rising from the ground a row at a time.
  const swarm = () => {
    introStart = performance.now()
    introEnd = 0
    finaleAt = Infinity
    for (const g of glyphs) {
      if (g.tower) {
        g.ox = (Math.random() - 0.5) * 30
        g.oy = size.h * (1.2 + Math.random() * 0.6)
        g.delay = intro(1800 + (1 - g.hy / size.h) * 1400 + Math.random() * 300)
        g.dur = intro(1200 + Math.random() * 500)
        finaleAt = Math.min(finaleAt, g.delay)
      } else {
        const angle = Math.random() * Math.PI * 2
        const dist = 120 + Math.random() * 380
        g.ox = Math.cos(angle) * dist
        g.oy = Math.sin(angle) * dist * 0.45
        g.delay = intro((g.hx / size.w) * 900 + Math.random() * 500)
        g.dur = intro(1800 + Math.random() * 1500)
      }
      g.dx = g.ox
      g.dy = g.oy
      introEnd = Math.max(introEnd, g.delay + g.dur)
    }
    if (finaleAt === Infinity) finaleAt = 0
    draw(introStart)
    animate()
  }

  // The letters swarm in only on the page that was loaded (see router.ts), never
  // on the way back from an article.
  const playIntro = motion && 'intro' in page.dataset
  onWidth(figure, signal, () => {
    layout()
    if (playIntro && !introStart && !document.hidden) swarm()
  })

  if (motion) {
    figure.addEventListener(
      'pointermove',
      (e) => {
        const box = figure.getBoundingClientRect()
        pointer = { x: e.clientX - box.left, y: e.clientY - box.top }
        animate()
      },
      { signal },
    )
    figure.addEventListener(
      'pointerleave',
      () => {
        pointer = null
        animate()
      },
      { signal },
    )
  }
  dark.addEventListener('change', layout, { signal })
  signal.addEventListener('abort', () => cancelAnimationFrame(frame))
  return true
}
