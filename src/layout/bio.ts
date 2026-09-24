// "About the editor": the bio set inside a microchip, as a small toy.
//  - The words arrive like snow, each falling into the spot pretext laid out for it.
//  - The KC die can be dragged (or nudged with the arrow keys); the bio re-flows
//    around it on every frame.
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
/** Small enough that only the first line is indented by the pin-1 corner. */
const CHAMFER = 18
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
    { x: INSET + CHAMFER, y: INSET },
    { x: state.width - INSET, y: INSET },
    { x: state.width - INSET, y: height - INSET },
    { x: INSET, y: height - INSET },
    { x: INSET, y: INSET + CHAMFER },
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

  const render = () => {
    for (const w of words) w.el.style.transform = `translate(${w.x.toFixed(1)}px, ${w.y.toFixed(1)}px)`
    die.style.transform = `translate(${(PIN + state.dieX - state.radius).toFixed(1)}px, ${(PIN + state.dieY - state.radius).toFixed(1)}px)`
  }

  const resize = (height: number) => {
    state.height = height
    drawChip(art, state.width, height)
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

function drawChip(svg: SVGSVGElement, width: number, height: number) {
  const w = width + PIN * 2
  const h = height + PIN * 2
  const pins: string[] = []
  for (let y = PIN + 20; y <= PIN + height - 20; y += 17) {
    pins.push(`<rect x="0" y="${y - 2.5}" width="${PIN + 1}" height="5" rx="1"/>`, `<rect x="${w - PIN - 1}" y="${y - 2.5}" width="${PIN + 1}" height="5" rx="1"/>`)
  }
  for (let x = PIN + 20; x <= PIN + width - 20; x += 17) {
    pins.push(`<rect x="${x - 2.5}" y="0" width="5" height="${PIN + 1}" rx="1"/>`, `<rect x="${x - 2.5}" y="${h - PIN - 1}" width="5" height="${PIN + 1}" rx="1"/>`)
  }
  const r = 5
  const c = 14
  const x0 = PIN
  const y0 = PIN
  const x1 = PIN + width
  const y1 = PIN + height
  const body = `M${x0 + c} ${y0} H${x1 - r} Q${x1} ${y0} ${x1} ${y0 + r} V${y1 - r} Q${x1} ${y1} ${x1 - r} ${y1} H${x0 + r} Q${x0} ${y1} ${x0} ${y1 - r} V${y0 + c} Z`
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
  svg.setAttribute('width', String(w))
  svg.setAttribute('height', String(h))
  svg.innerHTML = `<g class="bio__pins">${pins.join('')}</g>
    <path class="bio__body" d="${body}"/>
    <circle class="bio__dot" cx="${x0 + 9}" cy="${y1 - 9}" r="2.5"/>
    <text class="bio__silk" x="${x1 - 10}" y="${y1 - 7}" text-anchor="end">U1 · TORONTO / KUWAIT</text>`
}
