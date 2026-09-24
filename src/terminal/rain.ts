// Digital rain for the terminal, made of the site's own words.
//
// pretext sets it. A story is broken into lines as if each column of rain
// were a page as many characters wide as the column is tall (in a
// monospaced font, a line N characters long fills N rows), and each drop
// writes one of those lines down its column. So a drop always carries whole
// words: read one top to bottom and you get a phrase from the story.
//
// The cursor is an obstacle, the way the KC die is for the bio. Each row of
// rain finds where the cursor's circle cuts it (geometry.ts) and packs its
// characters into the room left on either side, so the streams bend around
// the cursor. The rain only looks at the cursor every GLITCH_MS, so it jumps
// instead of sliding, and whatever gets pushed flickers and splits into the
// palette's oranges.
import { layoutNextLine, type LayoutCursor, type PreparedTextWithSegments } from '@chenglou/pretext'
import { canvasFont, FAMILY, fontsReady, type FontSpec } from '../layout/fonts'
import { circleObstacle, type Interval } from '../layout/geometry'
import { prep } from '../layout/text'

export interface Rain {
  /** Stops it for good, leaving the last frame (without the cursor's dent) on screen. */
  stop(): void
  /** Holds it still while something covers it, like the reader. */
  pause(paused: boolean): void
}

const FONT: FontSpec = { family: FAMILY.mono, weight: 400, size: 14 }
/** Row height, px: tighter than the terminal's lines, as rain should be. */
const ROW = 17
/** How close the cursor gets before the rain moves aside, px. */
const REACH = 36
/** How often the rain looks at the cursor, ms. */
const GLITCH_MS = 70
/** It draws at about 30 frames a second; the drops move a row at a time anyway. */
const FRAME_MS = 1000 / 30
/** How long a character stays lit as the head of its drop, ms, and then bright green. */
const HEAD_MS = 90
const GLOW_MS = 450
/** What a character flickers to. */
const NOISE = '01<>[]{}()/\\|=+*#$%&@?;:~^'
const START: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }

/** Ranges picked from at random: ms between drops in a column, rows per second, and ms each character takes to fade. */
const PACE = {
  pane: { gap: [1200, 6000], speed: [5, 12], fade: [1200, 2600] },
  full: { gap: [300, 3200], speed: [8, 20], fade: [1000, 2400] },
} as const

interface Drop {
  col: number
  /** The head, in rows. It moves smoothly and writes a character each time it enters a row. */
  y: number
  /** Rows per second. */
  speed: number
  /** The line of the story it writes. */
  text: string
  at: number
  /** How long each character it writes takes to fade, ms. */
  fade: number
}

/**
 * Starts the rain in `host`, which it fills. `full` is the full-screen
 * version (cmatrix): denser and faster, with longer drops. `still` (reduced
 * motion, low battery, Save-Data) draws one frame and stops there.
 */
export function startRain(host: HTMLElement, text: string, { full = false, still = false } = {}): Rain {
  let rain: Rain | null = null
  let stopped = false
  let paused = false
  void (async () => {
    // Without pretext there's no rain (see fontsReady).
    if (!(await fontsReady())) return
    await document.fonts.load(canvasFont(FONT), 'A0')
    if (stopped) return
    rain = run(host, text, full ? PACE.full : PACE.pane, still)
    rain.pause(paused)
  })()
  return {
    stop() {
      stopped = true
      rain?.stop()
    },
    pause(on) {
      paused = on
      rain?.pause(on)
    },
  }
}

function run(host: HTMLElement, text: string, pace: (typeof PACE)[keyof typeof PACE], still: boolean): Rain {
  const prepared = prep(ascii(text), FONT)
  const cw = prep('0', FONT).widths[0] || 8.4
  const canvas = document.createElement('canvas')
  host.replaceChildren(canvas)
  const ctx = canvas.getContext('2d')!
  const css = getComputedStyle(host)
  const ink = {
    head: css.getPropertyValue('--t-fg').trim() || '#e8efeb',
    rain: css.getPropertyValue('--t-green').trim() || '#30a67f',
    glow: css.getPropertyValue('--t-glow').trim() || '#5ad8aa',
    amber: css.getPropertyValue('--t-amber').trim() || '#fc8c02',
    flame: css.getPropertyValue('--t-flame').trim() || '#f4460a',
  }

  // The rain keeps its own time, which stands still while it's paused or out of sight,
  // so it picks up where it left off instead of every column starting at once.
  let clock = 0
  // The grid: one character per cell, each with when it was written and how long it lasts.
  let width = 0
  let height = 0
  let cols = 0
  let rows = 0
  let left = 0
  let chars: string[] = []
  let born = new Float64Array(0)
  let life = new Float32Array(0)
  let next = new Float64Array(0)
  let target = new Int32Array(0)
  let drops: Drop[] = []
  let cursor = randomStart(prepared)

  /** The next line of the story that fits down a column: whole words, at most one character per row. */
  const nextLine = () => {
    const max = rows * cw + 0.5
    let line = layoutNextLine(prepared, cursor, max)
    if (!line) {
      cursor = START
      line = layoutNextLine(prepared, cursor, max)
    }
    if (!line) return ''
    cursor = line.end
    return line.text.trim()
  }

  const step = (now: number, dt: number) => {
    for (let c = 0; c < cols; c++) {
      if (now < next[c]!) continue
      next[c] = now + rand(pace.gap[0], pace.gap[1])
      const text = rows >= 4 ? nextLine() : ''
      if (!text) continue
      const speed = rand(pace.speed[0], pace.speed[1])
      drops.push({ col: c, y: -1, speed, text, at: 0, fade: rand(pace.fade[0], pace.fade[1]) })
      // The next drop in this column waits until this one has finished writing.
      next[c]! += (text.length / speed) * 1000
    }
    for (const drop of drops) {
      const from = Math.floor(drop.y)
      drop.y += (drop.speed * dt) / 1000
      for (let r = from + 1; r <= Math.floor(drop.y) && drop.at < drop.text.length && r < rows; r++) {
        const i = r * cols + drop.col
        chars[i] = drop.text[drop.at++]!
        born[i] = now
        life[i] = drop.fade
      }
    }
    drops = drops.filter((drop) => drop.at < drop.text.length && drop.y < rows)
  }

  // The cursor (in the window's coordinates), and where the rain last saw it (in its own).
  let pointer: { x: number; y: number } | null = null
  let aim: { x: number; y: number; r: number } | null = null
  let lookedAt = -Infinity
  const look = (now: number) => {
    if (now - lookedAt < GLITCH_MS) return
    lookedAt = now
    if (!pointer) {
      aim = null
      return
    }
    const box = canvas.getBoundingClientRect()
    const x = pointer.x - box.left
    const y = pointer.y - box.top
    const near = x > -REACH && x < box.width + REACH && y > -REACH && y < box.height + REACH
    // A slightly different reach every look, so the edge of the dent shivers.
    aim = near ? { x, y, r: REACH * rand(0.85, 1.15) } : null
  }

  const shows = (i: number, now: number) => {
    const ch = chars[i]
    if (!ch || ch === ' ') return false
    if (now - born[i]! < life[i]!) return true
    chars[i] = ''
    return false
  }

  /**
   * Where each character of row r goes when the cursor cuts the row: the ones
   * under it are pushed out to the nearer side, each pushing its neighbours
   * along until there's a gap to take them (like beads on a wire). Returns
   * false if nothing in the row moves.
   */
  const place = (r: number, cut: Interval, mid: number, now: number) => {
    for (let c = 0; c < cols; c++) target[c] = c
    const first = Math.ceil((cut.left - left) / cw - 0.5)
    const last = Math.floor((cut.right - left) / cw - 0.5)
    if (first > last) return false
    const split = Math.floor((mid - left) / cw - 0.5)
    let moved = false
    let limit = first - 1
    for (let c = Math.min(cols - 1, split); c >= 0; c--) {
      if (!shows(r * cols + c, now)) continue
      if (c <= limit) break
      target[c] = limit--
      moved = true
    }
    limit = last + 1
    for (let c = Math.max(0, split + 1); c < cols; c++) {
      if (!shows(r * cols + c, now)) continue
      if (c >= limit) break
      target[c] = limit++
      moved = true
    }
    return moved
  }

  // The brightest characters (each drop's head, and whatever the cursor has pushed) are drawn last, glowing.
  const lit: Array<{ ch: string; x: number; y: number; alpha: number; moved: boolean }> = []

  const draw = (now: number) => {
    ctx.clearRect(0, 0, width, height)
    ctx.font = canvasFont(FONT)
    ctx.textBaseline = 'middle'
    const tick = Math.floor(now / GLITCH_MS)
    const flicker = Math.floor(now / 120)
    const obstacle = aim ? circleObstacle(aim.x, aim.y, aim.r) : null
    lit.length = 0
    for (let r = 0; r < rows; r++) {
      const top = r * ROW
      const y = top + ROW / 2 + 0.5
      const cut = obstacle?.band(top, top + ROW)
      const bent = !!cut && place(r, cut, aim!.x, now)
      // Now and then a bent row tears a cell to one side.
      const tear = bent && hash(r, tick) < 0.15 ? (hash(tick, r) < 0.5 ? -1 : 1) : 0
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c
        if (!shows(i, now)) continue
        const age = now - born[i]!
        const fade = 1 - age / life[i]!
        const moved = bent && target[c] !== c
        const col = moved ? target[c]! + tear : c
        if (col < 0 || col >= cols) continue
        const x = left + col * cw
        let ch = chars[i]!
        // The rain's own flicker, and a lot more of it wherever the cursor has pushed.
        if (hash(i, moved ? tick : flicker) < (moved ? 0.25 : 0.012)) ch = NOISE[Math.floor(hash(tick, i) * NOISE.length)]!
        if (moved || age < HEAD_MS) {
          lit.push({ ch, x, y, alpha: moved ? Math.max(fade, 0.8) : 1, moved })
          continue
        }
        // Bright green just behind the head, then fading slowly through the leaf green.
        ctx.globalAlpha = fade ** 0.7
        ctx.fillStyle = age < GLOW_MS ? ink.glow : ink.rain
        ctx.fillText(ch, x, y)
      }
    }
    // What the cursor pushed splits into the oranges, like a signal that's slipping.
    for (const { ch, x, y, alpha, moved } of lit) {
      if (!moved) continue
      ctx.globalAlpha = 0.75 * alpha
      ctx.fillStyle = ink.flame
      ctx.fillText(ch, x - 1.5, y)
      ctx.fillStyle = ink.amber
      ctx.fillText(ch, x + 1.5, y)
    }
    ctx.shadowColor = ink.glow
    ctx.shadowBlur = 6 * (devicePixelRatio || 1)
    ctx.fillStyle = ink.head
    for (const { ch, x, y, alpha } of lit) {
      ctx.globalAlpha = alpha
      ctx.fillText(ch, x, y)
    }
    ctx.shadowBlur = 0
    ctx.globalAlpha = 1
  }

  /** Fills the grid for the host's current size, with the rain already falling. */
  const resize = () => {
    width = host.clientWidth
    height = host.clientHeight
    const dpr = devicePixelRatio || 1
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    cols = Math.max(0, Math.floor(width / cw))
    rows = Math.max(0, Math.floor(height / ROW))
    left = (width - cols * cw) / 2
    chars = new Array<string>(cols * rows).fill('')
    born = new Float64Array(cols * rows)
    life = new Float32Array(cols * rows)
    target = new Int32Array(cols)
    drops = []
    // Run it for a few seconds first, so it's already falling when it appears.
    next = new Float64Array(cols).map(() => clock + rand(0, pace.gap[1]))
    for (const end = clock + 4000; clock < end; clock += 50) step(clock, 50)
    draw(clock)
  }

  const controller = new AbortController()
  const { signal } = controller
  let frame = 0
  let last = 0
  let visible = true
  let paused = false
  // Each start of the loop has a number; a frame left over from an earlier start does nothing.
  let generation = 0
  let running = false

  const loop = (now: number, mine: number) => {
    if (mine !== generation) return
    frame = requestAnimationFrame((t) => loop(t, mine))
    const since = now - last
    if (since >= 0 && since < FRAME_MS - 2) return
    const dt = Math.min(100, Math.max(0, since))
    last = now
    clock += dt
    step(clock, dt)
    look(now)
    draw(clock)
  }
  const play = () => {
    const go = visible && !paused && !still && !signal.aborted
    if (go === running) return
    running = go
    const mine = ++generation
    cancelAnimationFrame(frame)
    if (go) {
      last = performance.now()
      frame = requestAnimationFrame((t) => loop(t, mine))
    }
  }

  // Laid out now, and again whenever the host changes size.
  let size = ''
  const fit = () => {
    const now = `${host.clientWidth}x${host.clientHeight}`
    if (now === size) return
    size = now
    resize()
  }
  fit()
  const resizes = new ResizeObserver(fit)
  resizes.observe(host)
  const sight = new IntersectionObserver(([entry]) => {
    visible = !!entry?.isIntersecting
    play()
  })
  sight.observe(host)

  if (!still) {
    const track = (event: PointerEvent) => {
      pointer = { x: event.clientX, y: event.clientY }
    }
    // A finger only counts while it's down; a mouse counts until it leaves the window.
    const lift = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') pointer = null
    }
    document.addEventListener('pointermove', track, { passive: true, signal })
    document.addEventListener('pointerdown', track, { passive: true, signal })
    document.addEventListener('pointerup', lift, { passive: true, signal })
    document.addEventListener('pointercancel', lift, { passive: true, signal })
    document.documentElement.addEventListener('mouseleave', () => (pointer = null), { signal })
  }

  return {
    stop() {
      controller.abort()
      resizes.disconnect()
      sight.disconnect()
      play()
      // Leave the rain as it was, minus the dent.
      if (aim && cols) {
        aim = null
        draw(clock)
      }
    },
    pause(on) {
      paused = on
      play()
    },
  }
}

/** The rain is ASCII: accents come off, typographic punctuation goes plain, anything else becomes a space. */
export function ascii(text: string) {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u00d7/g, 'x')
    .replace(/\u2026/g, '...')
    .replace(/[^\x20-\x7e]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Somewhere at the start of a word, so the rain doesn't always open with the headline. */
function randomStart(prepared: PreparedTextWithSegments): LayoutCursor {
  const starts: number[] = []
  prepared.kinds.forEach((kind, i) => {
    if (kind === 'text' && (i === 0 || prepared.kinds[i - 1] === 'space')) starts.push(i)
  })
  return { segmentIndex: starts[Math.floor(Math.random() * starts.length)] ?? 0, graphemeIndex: 0 }
}

const rand = (min: number, max: number) => min + Math.random() * (max - min)

/** A repeatable random number in [0, 1) for a pair of integers (so a flicker holds for its whole tick). */
function hash(a: number, b: number) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
