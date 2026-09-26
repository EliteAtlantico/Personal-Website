// "About the editor": the bio set on a small circuit board, as a toy.
//  - The words arrive like snow, each falling into the spot pretext laid out for it.
//  - The KC die can be dragged (or nudged with the arrow keys); the bio re-flows
//    around it on every frame, and the board's copper traces re-route to stay
//    soldered to it.
//  - Click the chip to throw a snowball: nearby words get knocked loose, then
//    drift back into place.
// The chip is exactly as tall as the text needs (found by binary search).
import { flow, type PositionedLine } from './flow'
import { FAMILY, canvasFont, measuring, type FontSpec } from './fonts'
import { circleObstacle, insideBand, type Point } from './geometry'
import { onWidth } from './observe'
import { intro } from './pace'
import { prep } from './text'

const PIN = 9
const INSET = 16
/** The board's corner radius. */
const CORNER = 10
const FONT: FontSpec = { family: FAMILY.text, weight: 400, size: 15 }
const LINE_HEIGHT = 21
const DIE_PAD = 9
const KNOCK_RADIUS = 80

interface Word {
  el: HTMLSpanElement
  width: number
  /** Where the layout puts it (chip-body coordinates). */
  hx: number
  hy: number
  x: number
  y: number
  vx: number
  vy: number
  mode: 'home' | 'snow' | 'knocked'
  // Snowfall
  t0: number
  dur: number
  sx: number
  sy: number
  sway: number
  phase: number
  /** When a knocked word starts heading home. */
  back: number
}

export function layoutBio(page: HTMLElement, signal: AbortSignal) {
  const bio = page.querySelector<HTMLElement>('.bio')
  const chip = bio?.querySelector<HTMLElement>('.bio__chip')
  const source = bio?.querySelector<HTMLElement>('.bio__text')
  if (!bio || !chip || !source) return
  const prepared = prep((source.textContent ?? '').replace(/\s+/g, ' ').trim(), FONT)
  const motion = !matchMedia('(prefers-reduced-motion: reduce)').matches

  source.classList.add('sr-only')
  bio.classList.add('is-shaped')
  const art = chip.querySelector('svg') ?? chip.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'))
  art.setAttribute('class', 'bio__art')
  art.setAttribute('aria-hidden', 'true')
  const layer = child(chip, 'bio__words', 'div')
  layer.setAttribute('aria-hidden', 'true')
  const die = child(chip, 'bio__die', 'div')
  Object.assign(die, { tabIndex: 0, textContent: 'KC' })
  die.setAttribute('role', 'img')
  die.setAttribute('aria-roledescription', 'draggable stamp')
  die.setAttribute('aria-label', 'KC stamp. Drag it, or use the arrow keys, and the bio flows around it.')

  // Word widths come from the same canvas measurement pretext uses.
  const ctx = measuring()!
  const widths = new Map<string, number>()
  const measure = (text: string) => {
    let width = widths.get(text)
    if (width === undefined) {
      ctx.font = canvasFont(FONT)
      widths.set(text, (width = ctx.measureText(text).width))
    }
    return width
  }
  const space = measure(' ')

  const state = { width: 0, height: 0, radius: 40, dieX: Number.NaN, dieYRatio: 0.42, dieY: 0 }
  const words: Word[] = []
  /**
   * Words wait above the chip (clipped out of sight) until the snowfall starts.
   * That only happens on the page that was loaded (see router.ts); coming back
   * from an article, they're simply in place.
   */
  let waiting = motion && 'intro' in page.dataset

  const shape = (height: number): Point[] => [
    { x: INSET, y: INSET },
    { x: state.width - INSET, y: INSET },
    { x: state.width - INSET, y: height - INSET },
    { x: INSET, y: height - INSET },
  ]
  const lay = (height: number, dieY: number) =>
    flow([prepared], {
      regions: [{ x: 0, y: INSET, width: state.width, height: height - INSET * 2 }],
      lineHeight: LINE_HEIGHT,
      // A few px of slack on the right absorbs rounding across per-word measurements.
      allowed: (top, bottom) => {
        const inside = insideBand(shape(height), top, bottom)
        return inside && { left: inside.left, right: inside.right - 3 }
      },
      obstacles: [circleObstacle(state.dieX, dieY, state.radius, DIE_PAD)],
      minSlot: 34,
    })

  /** Shortest chip that holds the whole bio, with the die at `dieY` (or at its ratio of the height). */
  const fit = (atY?: number) => {
    const yFor = (h: number) => atY ?? h * state.dieYRatio
    let lo = 120
    let hi = 1600
    let result = lay(hi, yFor(hi))
    for (let i = 0; i < 14 && hi - lo > 1; i++) {
      const mid = (lo + hi) / 2
      const attempt = lay(mid, yFor(mid))
      if (attempt.done) {
        hi = mid
        result = attempt
      } else lo = mid
    }
    return { height: Math.ceil(hi), lines: result.lines, dieY: yFor(hi) }
  }

  const clampDie = () => {
    const r = state.radius
    state.dieX = Math.min(Math.max(state.dieX, INSET + r), state.width - INSET - r)
    state.dieY = Math.min(Math.max(state.dieY, INSET + r), state.height - INSET - r)
  }

  /** Lines → one span per word, each with a home position. */
  const place = (lines: PositionedLine[]) => {
    const homes: Array<{ text: string; x: number; y: number }> = []
    for (const line of lines) {
      let x = line.x
      for (const part of line.text.replace(/\u00AD/g, '').trimEnd().split(' ')) {
        if (part) homes.push({ text: part, x, y: line.y })
        x += measure(part) + space
      }
    }
    while (words.length < homes.length) {
      const el = document.createElement('span')
      el.className = 'bio__word'
      layer.append(el)
      words.push({ el, width: 0, hx: 0, hy: 0, x: 0, y: -LINE_HEIGHT * 2, vx: 0, vy: 0, mode: waiting ? 'snow' : 'home', t0: Infinity, dur: 1, sx: 0, sy: -LINE_HEIGHT * 2, sway: 0, phase: 0, back: 0 })
    }
    while (words.length > homes.length) words.pop()!.el.remove()
    homes.forEach((home, i) => {
      const word = words[i]!
      if (word.el.textContent !== home.text) word.el.textContent = home.text
      word.width = measure(home.text)
      word.hx = home.x
      word.hy = home.y
      if (word.mode === 'home') {
        word.x = home.x
        word.y = home.y
      }
    })
    render()
  }

  let routed = ''
  const render = () => {
    for (const w of words) w.el.style.transform = `translate(${w.x.toFixed(1)}px, ${w.y.toFixed(1)}px)`
    // Its own translate, not transform: picked up, it scales about its middle (scale comes after translate).
    die.style.translate = `${(PIN + state.dieX - state.radius).toFixed(1)}px ${(PIN + state.dieY - state.radius).toFixed(1)}px`
    // The copper follows the die: routed again only when the die or the board has moved.
    const at = `${state.width}|${state.height}|${state.dieX.toFixed(1)}|${state.dieY.toFixed(1)}|${state.radius}`
    if (at !== routed) {
      routed = at
      const [copper, marks] = [art.querySelector('.bio__traces'), art.querySelector('.bio__marks')]
      const drawn = traces(state.width, state.height, state.dieX, state.dieY, state.radius)
      if (copper) copper.innerHTML = drawn.copper
      if (marks) marks.innerHTML = drawn.marks
    }
  }

  const resize = (height: number) => {
    state.height = height
    drawChip(art, state.width, height)
    routed = ''
    const w = state.width + PIN * 2
    chip.style.width = `${w}px`
    chip.style.height = `${height + PIN * 2}px`
    Object.assign(layer.style, { left: `${PIN}px`, top: `${PIN}px`, width: `${state.width}px`, height: `${height}px` })
  }

  // --- Layout on width changes ---
  onWidth(bio, signal, (available) => {
    state.width = Math.min(available, 400) - PIN * 2
    state.radius = Math.max(30, Math.min(46, state.width * 0.14))
    if (Number.isNaN(state.dieX)) state.dieX = state.width - INSET - state.radius - 2
    die.style.width = die.style.height = `${state.radius * 2}px`
    clampDie()
    const { height, lines, dieY } = fit()
    state.dieY = dieY
    resize(height)
    clampDie()
    place(lines)
  })

  // --- Animation: snowfall in, snowballs, drifting home ---
  let frame = 0
  let last = 0
  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - (last || now)) / 1000)
    last = now
    let busy = false
    for (const w of words) {
      if (w.mode === 'snow') {
        const t = Math.max(0, Math.min(1, (now - w.t0) / w.dur))
        const e = 1 - (1 - t) ** 2
        w.x = w.sx + (w.hx - w.sx) * e + w.sway * Math.sin(w.phase + t * 6) * (1 - e)
        w.y = w.sy + (w.hy - w.sy) * e
        if (t >= 1) {
          w.mode = 'home'
          w.x = w.hx
          w.y = w.hy
        } else busy = true
      } else if (w.mode === 'knocked') {
        if (now < w.back) {
          // Flying: drag and a little gravity.
          w.vx *= 0.9
          w.vy = w.vy * 0.9 + 900 * dt
        } else {
          // Heading home on a critically damped spring.
          const k = 140
          const c = 2 * Math.sqrt(k)
          w.vx += (-k * (w.x - w.hx) - c * w.vx) * dt
          w.vy += (-k * (w.y - w.hy) - c * w.vy) * dt
        }
        w.x += w.vx * dt
        w.y += w.vy * dt
        if (now >= w.back && Math.abs(w.x - w.hx) < 0.4 && Math.abs(w.y - w.hy) < 0.4 && Math.hypot(w.vx, w.vy) < 8) {
          w.mode = 'home'
          w.x = w.hx
          w.y = w.hy
        } else busy = true
      }
    }
    render()
    frame = busy ? requestAnimationFrame(tick) : 0
    if (!busy) last = 0
  }
  const animate = () => {
    if (!frame) frame = requestAnimationFrame(tick)
  }

  const snowfall = () => {
    waiting = false
    const now = performance.now()
    for (const w of words) {
      w.mode = 'snow'
      w.t0 = now + intro(Math.random() * 1400)
      w.dur = intro(1800 + Math.random() * 1500)
      w.sx = w.hx + (Math.random() - 0.5) * 70
      w.sy = -LINE_HEIGHT - Math.random() * state.height * 0.9
      w.sway = 8 + Math.random() * 16
      w.phase = Math.random() * Math.PI * 2
      w.x = w.sx
      w.y = w.sy
    }
    render()
    animate()
  }

  const snowball = (x: number, y: number) => {
    const poof = document.createElement('span')
    poof.className = 'bio__poof'
    poof.style.left = `${x}px`
    poof.style.top = `${y}px`
    layer.append(poof)
    setTimeout(() => poof.remove(), 700)
    if (!motion) return
    const now = performance.now()
    for (const w of words) {
      const dx = w.x + w.width / 2 - x
      const dy = w.y + LINE_HEIGHT / 2 - y
      const d = Math.hypot(dx, dy)
      if (d > KNOCK_RADIUS) continue
      const force = 560 * (1 - d / KNOCK_RADIUS)
      w.mode = 'knocked'
      w.vx = ((dx / d) || 0) * force + (Math.random() - 0.5) * 80
      w.vy = ((dy / d) || 0) * force - 180 * (1 - d / KNOCK_RADIUS)
      w.back = now + 220 + Math.random() * 200
    }
    animate()
  }

  // The words fall in the first time the chip is on screen: checked on load, on
  // scroll, when the tab becomes visible, and by an IntersectionObserver.
  if (waiting) {
    const seen = new IntersectionObserver(() => trigger(), { threshold: 0.25 })
    const trigger = () => {
      if (!waiting) return
      const r = chip.getBoundingClientRect()
      if (r.bottom < 0 || r.top > window.innerHeight) return
      seen.disconnect()
      snowfall()
    }
    seen.observe(chip)
    window.addEventListener('scroll', trigger, { passive: true, signal })
    document.addEventListener('visibilitychange', trigger, { signal })
    requestAnimationFrame(trigger)
    // Failsafe: never leave the bio invisible (e.g. a background tab that never paints).
    const failsafe = setTimeout(() => {
      if (!waiting) return
      waiting = false
      seen.disconnect()
      for (const w of words) Object.assign(w, { mode: 'home', x: w.hx, y: w.hy })
      render()
    }, 6000)
    signal.addEventListener('abort', () => {
      seen.disconnect()
      clearTimeout(failsafe)
    })
  }

  // --- Dragging the die ---
  let dragged = false
  die.addEventListener(
    'pointerdown',
    (down) => {
      if (down.button !== 0) return
      down.preventDefault()
      try {
        die.setPointerCapture(down.pointerId)
      } catch {
        // Synthetic or already-released pointers can't be captured; dragging still works while over the die.
      }
      die.classList.add('is-dragging')
      bio.classList.add('was-dragged')
      dragged = false
      const start = { x: state.dieX, y: state.dieY, px: down.clientX, py: down.clientY }
      let pending = 0
      const move = (event: PointerEvent) => {
        dragged = true
        state.dieX = start.x + event.clientX - start.px
        state.dieY = start.y + event.clientY - start.py
        cancelAnimationFrame(pending)
        pending = requestAnimationFrame(() => {
          clampDie()
          // Keep the chip's height while dragging (grow only if the text needs it), so the page doesn't jump.
          const now = lay(state.height, state.dieY)
          if (now.done) place(now.lines)
          else {
            const grown = fit(state.dieY)
            resize(Math.max(grown.height, state.height))
            place(grown.lines)
          }
        })
      }
      // This drag's listeners, all removed together when it ends (however it ends).
      const drag = new AbortController()
      const up = () => {
        drag.abort()
        cancelAnimationFrame(pending)
        die.classList.remove('is-dragging')
        // Settle: shortest chip again, with the die where it was dropped.
        const settled = fit(state.dieY)
        state.dieYRatio = state.dieY / settled.height
        resize(settled.height)
        clampDie()
        place(settled.lines)
      }
      const listen = { signal: AbortSignal.any([drag.signal, signal]) }
      die.addEventListener('pointermove', move, listen)
      die.addEventListener('pointerup', up, listen)
      die.addEventListener('pointercancel', up, listen)
    },
    { signal },
  )

  die.addEventListener(
    'keydown',
    (event) => {
      const step = event.shiftKey ? 30 : 8
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
      const delta = moves[event.key]
      if (!delta) return
      event.preventDefault()
      state.dieX += delta[0]
      state.dieY += delta[1]
      clampDie()
      const settled = fit(state.dieY)
      state.dieYRatio = state.dieY / settled.height
      resize(settled.height)
      place(settled.lines)
    },
    { signal },
  )

  // --- Snowballs: click anywhere on the chip (but not while selecting text or dragging) ---
  chip.addEventListener(
    'click',
    (event) => {
      if (dragged || (event.target as Element).closest('.bio__die') || String(window.getSelection() ?? '').length) return
      const box = layer.getBoundingClientRect()
      snowball(event.clientX - box.left, event.clientY - box.top)
    },
    { signal },
  )
  signal.addEventListener('abort', () => cancelAnimationFrame(frame))
}

function child(parent: HTMLElement, className: string, tag: string) {
  const existing = parent.querySelector<HTMLElement>(`:scope > .${className}`)
  if (existing) return existing
  const el = document.createElement(tag)
  el.className = className
  parent.append(el)
  return el
}

interface Point2 {
  x: number
  y: number
}

/** Where the pads sit along a side of the board (board coordinates): every 22px, clear of the corners. */
function padsAlong(length: number) {
  const at: number[] = []
  for (let p = 24; p <= length - 24; p += 22) at.push(p)
  return at
}

/**
 * The board, drawn flat like an illustration of one: its edge (it has some
 * thickness), the matte solder mask, brass half-holes along every side like a
 * module made to be soldered onto a bigger board, mounting holes, a few tiny
 * parts and the silkscreen. The copper (traces()) goes on the mask, a shade
 * lighter than it, as copper under a mask shows.
 */
function drawChip(svg: SVGSVGElement, width: number, height: number) {
  const w = width + PIN * 2
  const h = height + PIN * 2
  const [x0, y0, x1, y1, r] = [PIN, PIN, PIN + width, PIN + height, CORNER]
  const board = `M${x0 + r} ${y0} H${x1 - r} Q${x1} ${y0} ${x1} ${y0 + r} V${y1 - r} Q${x1} ${y1} ${x1 - r} ${y1} H${x0 + r} Q${x0} ${y1} ${x0} ${y1 - r} V${y0 + r} Q${x0} ${y0} ${x0 + r} ${y0} Z`
  const pads: string[] = []
  const notches: string[] = []
  const castellate = (x: number, y: number, side: 'left' | 'right' | 'top' | 'bottom') => {
    // 2px over the edge, 6px onto the board, with the plated half-hole at the edge.
    if (side === 'left' || side === 'right') pads.push(`<rect x="${side === 'left' ? x - 2 : x - 6}" y="${y - 2.5}" width="8" height="5" rx="1"/>`)
    else pads.push(`<rect x="${x - 2.5}" y="${side === 'top' ? y - 2 : y - 6}" width="5" height="8" rx="1"/>`)
    notches.push(`<circle cx="${x}" cy="${y}" r="1.5"/>`)
  }
  for (const y of padsAlong(height)) castellate(x0, y0 + y, 'left'), castellate(x1, y0 + y, 'right')
  for (const x of padsAlong(width)) castellate(x0 + x, y0, 'top'), castellate(x0 + x, y1, 'bottom')
  const holes = [
    [x0 + 8.5, y0 + 8.5],
    [x1 - 8.5, y0 + 8.5],
    [x0 + 8.5, y1 - 8.5],
    [x1 - 8.5, y1 - 8.5],
  ]
  // A resistor and two capacitors in the margins (an 0402 part is a dark body between two metal ends).
  const part = (x: number, y: number) => `<rect class="bio__part" x="${x}" y="${y}" width="7" height="3.6" rx="0.6"/><rect x="${x - 1.4}" y="${y}" width="2" height="3.6" rx="0.5"/><rect x="${x + 6.4}" y="${y}" width="2" height="3.6" rx="0.5"/>`
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
  svg.setAttribute('width', String(w))
  svg.setAttribute('height', String(h))
  svg.innerHTML = `<path class="bio__edge" d="${board}" transform="translate(0 3)"/>
    <path class="bio__body" d="${board}"/>
    <g class="bio__traces"></g>
    <g class="bio__pads">${pads.join('')}${part(x1 - 44, y0 + 6)}${part(x0 + 76, y1 - 10)}${part(x0 + 92, y1 - 10)}</g>
    <g class="bio__notches">${notches.join('')}</g>
    <g class="bio__holes">${holes.map(([cx, cy]) => `<circle class="bio__ring" cx="${cx}" cy="${cy}" r="4.4"/><circle class="bio__hole" cx="${cx}" cy="${cy}" r="2.4"/>`).join('')}</g>
    <g class="bio__marks"></g>
    <text class="bio__silk" x="${x0 + 17}" y="${y0 + 11}">KC-01 REV A</text>
    <text class="bio__silk" x="${x1 - 16}" y="${y1 - 7}" text-anchor="end">U1 · TORONTO / KUWAIT</text>`
}

/**
 * The copper to the die: from each side of the board, a trace from each of the
 * two pads nearest it, routed the way a PCB's are (straight out of the pad, one
 * 45° jog, straight on in), landing on a pad around the die. Each side lands on
 * its own side of the die, in the same order as its pads, so no two cross. Plus
 * the die's outline in silkscreen. Board coordinates in, the SVG's out.
 */
function traces(width: number, height: number, cx: number, cy: number, radius: number) {
  const nearest = (positions: number[], at: number) =>
    [...positions]
      .sort((a, b) => Math.abs(a - at) - Math.abs(b - at))
      .slice(0, 2)
      .sort((a, b) => a - b)
  const sides = [
    { pads: nearest(padsAlong(height), cy).map((y) => ({ x: 4, y })), toward: Math.PI, across: true, turn: -1 },
    { pads: nearest(padsAlong(height), cy).map((y) => ({ x: width - 4, y })), toward: 0, across: true, turn: 1 },
    { pads: nearest(padsAlong(width), cx).map((x) => ({ x, y: 4 })), toward: -Math.PI / 2, across: false, turn: 1 },
    { pads: nearest(padsAlong(width), cx).map((x) => ({ x, y: height - 4 })), toward: Math.PI / 2, across: false, turn: -1 },
  ]
  const at = (p: Point2) => `${(p.x + PIN).toFixed(1)},${(p.y + PIN).toFixed(1)}`
  const copper: string[] = []
  for (const { pads, toward, across, turn } of sides) {
    pads.forEach((from, i) => {
      const angle = toward + (i - (pads.length - 1) / 2) * 0.46 * turn
      const land = { x: cx + Math.cos(angle) * (radius + 3), y: cy + Math.sin(angle) * (radius + 3) }
      const path = route(from, land, across)
      copper.push(`<polyline class="bio__trace" points="${path.map(at).join(' ')}"/>`)
      // A via where every second trace jogs, and a land where each one meets the die.
      if (i === 1) copper.push(`<circle class="bio__via" cx="${(path[2]!.x + PIN).toFixed(1)}" cy="${(path[2]!.y + PIN).toFixed(1)}" r="2.4"/>`)
      copper.push(`<circle class="bio__land" cx="${(land.x + PIN).toFixed(1)}" cy="${(land.y + PIN).toFixed(1)}" r="2.2"/>`)
    })
  }
  const marks = `<circle class="bio__outline" cx="${(cx + PIN).toFixed(1)}" cy="${(cy + PIN).toFixed(1)}" r="${(radius + 6.5).toFixed(1)}"/>`
  return { copper: copper.join(''), marks }
}

/** Straight out of the pad (across the board if `across`, else up or down it), a 45° jog, then straight on to `to`. */
function route(from: Point2, to: Point2, across: boolean): Point2[] {
  const swap = (p: Point2) => (across ? p : { x: p.y, y: p.x })
  const [f, t] = [swap(from), swap(to)]
  const out = t.x - f.x
  const along = t.y - f.y
  const jog = Math.min(Math.abs(out), Math.abs(along))
  const straight = (Math.abs(out) - jog) / 2
  const dir = Math.sign(out) || 1
  const bend = { x: f.x + dir * straight, y: f.y }
  const after = { x: bend.x + dir * jog, y: f.y + (Math.sign(along) || 1) * jog }
  return [f, bend, after, t].map(swap)
}
