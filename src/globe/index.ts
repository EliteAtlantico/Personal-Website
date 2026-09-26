// A globe of where the stories happened: a dotted Earth in the site's
// palette, a dot for every story around the city it happened in (Toronto or
// Kuwait City), and an arc from one city to the other with the story about
// the move on top of it. Each dot carries its story's title, as many as fit
// without overlapping (labels.ts, with pretext's widths).
//
// It lives inside a host element: a tile on the front page, a pane on the
// terminal's dashboard, or the whole screen (the terminal's `globe`). The
// host brings its colours (CSS custom properties, so the paper's two themes
// and the terminal each get their own) and, for keyboard and screen-reader
// users, a list of the stories: focusing one turns the globe to its dot.
//
// It's drawn with WebGL directly (gl.ts): the sea, a haze at its edge, the
// land as dots, the cities, the arc and the stories are seven draw calls.
import { measureNaturalWidth } from '@chenglou/pretext'
import land from 'virtual:land'
import type { Item, Site } from '../content/types'
import { deskName } from '../render/paths'
import { FAMILY, type FontSpec } from '../layout/fonts'
import { prep } from '../layout/text'
import { calm } from '../signals'
import {
  compile,
  compiled,
  cross,
  dot,
  draw,
  length,
  linked,
  lookAtOrigin,
  mark,
  mix,
  multiply,
  normalize,
  normalMatrix,
  perspective,
  project,
  rgb,
  scale,
  slerp,
  sphere,
  tube,
  upload,
  type Buffers,
  type Program,
  type Vec3,
} from './gl'
import { placeLabels, type Anchor } from './labels'
import { landPoints, toVector } from './land'
import { orbit } from './orbit'
import { ARC_HEIGHT, pins } from './pins'
import { CITIES, places } from './places'

export interface GlobeOptions {
  site: Site
  /**
   * embed: in a tile or a pane. It turns slowly by itself, and scrolling
   * scrolls the page (no zoom). full: the whole screen, with zoom.
   */
  mode: 'embed' | 'full'
  /** A story was picked: its dot, its label, or its entry in the host's list. */
  open(item: Item): void
}

export interface Globe {
  /** Holds it still, while something covers it. */
  pause(on: boolean): void
  /**
   * Frees the graphics card. With `keep`, a still image of the globe stays behind: it's handed
   * the canvas with the last frame on it, and calls `done` once it has taken the canvas's place.
   */
  dispose(keep?: (canvas: HTMLCanvasElement, done: () => void) => void): void
}

const FOV = 30
const NEAR = 0.05
const FAR = 100
/** Titles and city names, as the CSS sets them (styles/globe.css): pretext measures them the same way. */
const LABEL: FontSpec = { family: FAMILY.mono, weight: 500, size: 10 }
const CITY: FontSpec = { family: FAMILY.mono, weight: 500, size: 10, tracking: 0.12 }
const LABEL_HEIGHT = 14
/** Where the camera starts: over the Atlantic side of Toronto, so the arc heads off east. */
const START = toVector(30, -62)

interface Label {
  id: string
  at: Vec3
  el: HTMLElement
  width: number
  city: boolean
  /** What the page shows now, so it's only touched when that changes. */
  shown: boolean
  x: number
  y: number
}

export function mountGlobe(host: HTMLElement, { site, mode, open }: GlobeOptions): Globe | null {
  const canvas = document.createElement('canvas')
  const context = { antialias: true, alpha: true, premultipliedAlpha: true, depth: true, powerPreference: mode === 'full' ? 'high-performance' : 'default' } as const
  const gl = (canvas.getContext('webgl2', context) ?? canvas.getContext('webgl', context)) as WebGLRenderingContext | null
  if (!gl) return null
  const still = calm()
  const embed = mode === 'embed'
  const controller = new AbortController()
  const { signal } = controller
  const ink = colours(host)

  const stage = document.createElement('div')
  stage.className = 'globe__stage'
  stage.setAttribute('aria-hidden', 'true')
  const layer = document.createElement('div')
  layer.className = 'globe__labels'
  stage.append(canvas, layer)
  host.prepend(stage)
  host.classList.add('is-live')
  const caption = host.querySelector<HTMLElement>('.globe__caption')
  const hint = caption?.textContent ?? ''

  // --- What's drawn: the sea, a haze at the edge, the land as dots, the cities, the arc, the stories ---
  const { cities, ...world } = earth()

  const where = places(site)
  const items = [...where.toronto, ...where.kuwait, ...where.between]
  const bySlug = new Map(items.map((item) => [item.slug, item]))
  const cityOf = new Map<string, string>()
  for (const [id, list] of Object.entries(where)) for (const item of list) cityOf.set(item.slug, id === 'between' ? 'Kuwait City to Toronto' : CITIES[id as 'toronto' | 'kuwait'].name)
  const dots = pins(where).map((pin) => ({ pin, at: toVector(pin.lat, pin.lng, pin.radius) }))
  const hotness = new Float32Array(dots.length)

  const meshes = { ...world, stories: { positions: new Float32Array(dots.flatMap(({ at }) => at)), hot: hotness } }

  // --- On the graphics card (again, if the browser ever takes it away and gives it back) ---
  const parallel = gl.getExtension('KHR_parallel_shader_compile') as { COMPLETION_STATUS_KHR: number } | null
  let gpu: {
    pending: Record<keyof typeof SHADERS, WebGLProgram>
    programs: Record<keyof typeof SHADERS, Program> | null
    buffers: { ocean: Buffers; air: Buffers; land: Buffers; arc: Buffers; dots: Buffers[]; rings: Buffers[]; stories: Buffers }
  } | null = null
  const setup = () => {
    const pending = Object.fromEntries(Object.entries(SHADERS).map(([name, [vertex, fragment]]) => [name, compile(gl, vertex, fragment)])) as Record<keyof typeof SHADERS, WebGLProgram>
    gpu = {
      pending,
      programs: null,
      buffers: {
        ocean: upload(gl, meshes.ocean),
        air: upload(gl, meshes.air),
        land: upload(gl, meshes.land),
        arc: upload(gl, meshes.arc),
        dots: meshes.dots.map((m) => upload(gl, m)),
        rings: meshes.rings.map((m) => upload(gl, m)),
        stories: upload(gl, meshes.stories),
      },
    }
  }
  /** The programs, once the driver has finished compiling them (null until then, or if they failed). */
  let broken = false
  const programs = () => {
    if (!gpu || broken) return null
    if (gpu.programs) return gpu.programs
    const pending = Object.values(gpu.pending)
    if (!pending.every((program) => compiled(gl, program, parallel))) return null
    const done = Object.fromEntries(Object.entries(gpu.pending).map(([name, program]) => [name, linked(gl, program, UNIFORMS[name as keyof typeof SHADERS])]))
    if (Object.values(done).some((p) => !p)) {
      broken = true
      return null
    }
    gpu.programs = done as Record<keyof typeof SHADERS, Program>
    return gpu.programs
  }
  const release = () => {
    if (!gpu) return
    const { pending, buffers } = gpu
    for (const program of Object.values(pending)) gl.deleteProgram(program)
    for (const b of [buffers.ocean, buffers.air, buffers.land, buffers.arc, buffers.stories, ...buffers.dots, ...buffers.rings]) {
      for (const { buffer } of b.attributes) gl.deleteBuffer(buffer)
      if (b.indices) gl.deleteBuffer(b.indices)
    }
    gpu = null
  }
  setup()
  canvas.addEventListener(
    'webglcontextlost',
    (event) => {
      event.preventDefault()
      gpu = null
    },
    { signal },
  )
  canvas.addEventListener('webglcontextrestored', setup, { signal })

  // --- Labels: the city names, and as many story titles as fit ---
  // Measured at the size the browser really draws them: a minimum font size (Safari's, say) can make
  // them bigger than the stylesheet's 10px, and then they'd overrun the room they were placed in.
  const drawn = document.createElement('span')
  drawn.className = 'globe__label'
  layer.append(drawn)
  const grow = parseFloat(getComputedStyle(drawn).fontSize) / LABEL.size || 1
  drawn.remove()
  const labelHeight = LABEL_HEIGHT * grow
  const label = (id: string, at: Vec3, text: string, font: FontSpec, className: string, city: boolean): Label => {
    const el = document.createElement('span')
    el.className = className
    el.textContent = text
    layer.append(el)
    return { id, at, el, width: Math.ceil(measureNaturalWidth(prep(text, { ...font, size: font.size * grow }))) + 1, city, shown: false, x: NaN, y: NaN }
  }
  const cityLabels = Object.values(CITIES).map((city) => label(city.id, toVector(city.lat, city.lng, 1.003), city.name.toUpperCase(), CITY, 'globe__label globe__label--city', true))
  const storyLabels = new Map(dots.map(({ pin, at }) => [pin.slug, label(pin.slug, at, bySlug.get(pin.slug)!.title, LABEL, 'globe__label', false)]))
  const labels = [...cityLabels, ...storyLabels.values()]

  // --- The camera ---
  const view = orbit({ element: canvas, signal, zoom: !embed, minDistance: 1.7, maxDistance: 6, zoomSpeed: 0.8, damping: 0.08, autoRotateSpeed: 0.45 })
  // In a tile, a vertical swipe still scrolls the page; a sideways drag turns the globe.
  canvas.style.touchAction = embed ? 'pan-y' : 'none'
  const home = embed ? 4.1 : 3.7
  view.position = scale(START, home)
  view.update(0)

  let flight: { from: Vec3; to: Vec3; start: number; duration: number } | null = null
  const flyTo = (direction: Vec3, distance: number) => {
    const target = scale(normalize(direction), distance)
    if (still) {
      view.position = target
      view.update(0)
      wake()
      return
    }
    const turn = Math.acos(Math.min(1, Math.max(-1, dot(normalize(view.position), normalize(target)))))
    flight = { from: view.position, to: target, start: performance.now(), duration: 380 + turn * 360 }
  }

  // --- Lighting up a story: its dot and label turn orange, and the caption names it ---
  let hot: string | null = null
  const stops = [...host.querySelectorAll<HTMLElement>('.globe__stories [data-slug]')]
  stops.forEach((stop, i) => (stop.tabIndex = i ? -1 : 0))
  signal.addEventListener('abort', () => stops.forEach((stop) => stop.removeAttribute('tabindex')))
  let hotChanged = false
  const setHot = (slug: string | null) => {
    if (slug === hot) return
    hot = slug
    dots.forEach(({ pin }, i) => (hotness[i] = pin.slug === slug ? 1 : 0))
    hotChanged = true
    for (const [id, { el }] of storyLabels) el.classList.toggle('is-hot', id === slug)
    const item = slug ? bySlug.get(slug) : undefined
    const where = item ? [item.title, deskName(site, item), cityOf.get(item.slug)].filter((part, i, all) => part && all.indexOf(part) === i).join(' · ') : ''
    // From the keyboard, say how to get to the next one.
    if (caption) caption.textContent = item ? (stops.includes(document.activeElement as HTMLElement) ? `${where} (\u2191 \u2193 for the others)` : where) : hint
    stage.classList.toggle('is-pointing', !!item)
    wake()
  }

  // --- Where things are on screen ---
  let width = 0
  let height = 0
  let ratio = 1
  const projection = new Float32Array(16)
  const viewMatrix = new Float32Array(16)
  const normals = new Float32Array(9)
  const toScreen = new Float32Array(16)
  const onScreen = (at: Vec3) => project(toScreen, at, width, height)
  const facing = (at: Vec3) => dot(normalize(at), normalize(view.position))
  const aim = () => {
    lookAtOrigin(view.position, viewMatrix)
    normalMatrix(viewMatrix, normals)
    multiply(projection, viewMatrix, toScreen)
  }

  // --- Pointing: a title under the pointer, or else the nearest dot; a click that isn't a drag opens it ---
  let placed: Array<{ id: string; x: number; y: number; width: number; height: number }> = []
  const pick = (event: PointerEvent) => {
    const box = stage.getBoundingClientRect()
    const x = event.clientX - box.left
    const y = event.clientY - box.top
    const titled = placed.find((l) => storyLabels.has(l.id) && x >= l.x - 2 && x <= l.x + l.width + 2 && y >= l.y && y <= l.y + l.height)
    if (titled) return titled.id
    let best: string | null = null
    let nearest = 14
    for (const { pin, at } of dots) {
      if (facing(at) < 0.15) continue
      const p = onScreen(at)
      const d = Math.hypot(p.x - x, p.y - y)
      if (d < nearest) [best, nearest] = [pin.slug, d]
    }
    return best
  }
  let pointerInside = false
  let resume = 0
  let down: { x: number; y: number; time: number } | null = null
  canvas.addEventListener('pointerdown', (event) => (down = { x: event.clientX, y: event.clientY, time: performance.now() }), { signal })
  canvas.addEventListener(
    'pointermove',
    (event) => {
      pointerInside = true
      if (!event.buttons) setHot(pick(event))
    },
    { signal },
  )
  canvas.addEventListener(
    'pointerleave',
    () => {
      pointerInside = false
      resume = performance.now() + 2500
      if (!host.contains(document.activeElement)) setHot(null)
    },
    { signal },
  )
  canvas.addEventListener(
    'pointerup',
    (event) => {
      const tap = down && Math.hypot(event.clientX - down.x, event.clientY - down.y) < 6 && performance.now() - down.time < 600
      down = null
      const slug = tap ? pick(event) : null
      const item = slug && bySlug.get(slug)
      if (item) open(item)
    },
    { signal },
  )

  // --- The host's list of stories: focus turns the globe to the story's dot ---
  host.addEventListener(
    'focusin',
    (event) => {
      const stop = (event.target as Element).closest<HTMLElement>('[data-slug]')
      const slug = stop?.dataset.slug
      const dot = slug && dots.find(({ pin }) => pin.slug === slug)
      if (!dot) return
      // Whichever story has focus (by Tab, arrow, click or screen reader) is the list's one Tab stop.
      if (stops.includes(stop)) for (const other of stops) other.tabIndex = other === stop ? 0 : -1
      setHot(slug)
      flyTo(dot.at, Math.min(length(view.position), embed ? home : 2.4))
    },
    { signal },
  )
  // One stop for Tab, not one per story: the arrow keys go from story to story, Home and End to the ends.
  host.addEventListener(
    'keydown',
    (event) => {
      const at = stops.indexOf(event.target as HTMLElement)
      const to = at < 0 ? undefined : { ArrowDown: at + 1, ArrowRight: at + 1, ArrowUp: at - 1, ArrowLeft: at - 1, Home: 0, End: stops.length - 1 }[event.key]
      if (to === undefined || event.altKey || event.ctrlKey || event.metaKey) return
      event.preventDefault()
      stops[(to + stops.length) % stops.length]!.focus()
    },
    { signal },
  )
  host.addEventListener(
    'focusout',
    (event) => {
      if (!host.contains(event.relatedTarget as Node | null) && !pointerInside) setHot(null)
    },
    { signal },
  )

  // --- Size ---
  let landScale = 1
  const fit = () => {
    width = stage.clientWidth
    height = stage.clientHeight
    if (!width || !height) return
    ratio = Math.min(devicePixelRatio || 1, 2)
    canvas.width = Math.floor(width * ratio)
    canvas.height = Math.floor(height * ratio)
    perspective(FOV, width / height, NEAR, FAR, projection)
    landScale = (height * ratio) / (2 * Math.tan((FOV * Math.PI) / 360))
  }
  fit()
  // A new size clears the canvas: draw again (even when resting).
  const resizes = new ResizeObserver(() => {
    fit()
    wake()
  })
  resizes.observe(stage)

  // --- The labels, placed every frame (the page is only touched where a label moved or came and went) ---
  const placeAll = () => {
    const anchors: Anchor[] = []
    for (const city of cityLabels) {
      if (facing(city.at) > 0.3) anchors.push({ id: city.id, ...onScreen(city.at), width: city.width, height: labelHeight, gap: 9, sides: ['above', 'below'] })
    }
    const story = (entry: Label) => {
      if (facing(entry.at) > (entry.id === hot ? 0.1 : 0.35)) anchors.push({ id: entry.id, ...onScreen(entry.at), width: entry.width, height: labelHeight, gap: 7 })
    }
    const lit = hot ? storyLabels.get(hot) : undefined
    if (lit) story(lit)
    for (const entry of storyLabels.values()) if (entry !== lit) story(entry)
    placed = placeLabels(anchors, { width, height })
    const spots = new Map<string, (typeof placed)[number]>()
    for (const spot of placed) spots.set(spot.id, spot)
    for (const entry of labels) {
      const spot = spots.get(entry.id)
      if (!!spot !== entry.shown) {
        entry.shown = !!spot
        entry.el.classList.toggle('is-shown', entry.shown)
      }
      if (!spot) continue
      const x = Math.round(spot.x)
      const y = Math.round(spot.y)
      if (x === entry.x && y === entry.y) continue
      entry.x = x
      entry.y = y
      entry.el.style.transform = `translate(${x}px, ${y}px)`
    }
  }

  // --- A frame ---
  const began = performance.now()
  const render = (now: number) => {
    const ready = programs()
    if (!ready || !gpu || !width) return
    const { buffers } = gpu
    const since = now - began
    const time = now / 1000
    if (hotChanged) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.stories.attributes.find((a) => a.index === 3)!.buffer)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, hotness)
      hotChanged = false
    }
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.enable(gl.CULL_FACE)
    const use = (program: Program, values: Record<string, number | Vec3>) => {
      gl.useProgram(program.program)
      const u = program.uniforms
      gl.uniformMatrix4fv(u.uView!, false, viewMatrix)
      gl.uniformMatrix4fv(u.uProjection!, false, projection)
      if (u.uNormalMatrix) gl.uniformMatrix3fv(u.uNormalMatrix, false, normals)
      for (const [name, value] of Object.entries(values)) {
        if (typeof value === 'number') gl.uniform1f(u[name]!, value)
        else gl.uniform3fv(u[name]!, value)
      }
    }

    // Solid first: the sea, and each city's dot.
    gl.disable(gl.BLEND)
    gl.depthMask(true)
    gl.cullFace(gl.BACK)
    use(ready.ocean, { uSea: ink.sea, uRim: mix(ink.sea, ink.air, 0.45) })
    draw(gl, buffers.ocean, gl.TRIANGLES)
    cities.forEach(({ center }, i) => {
      use(ready.mark, { uCenter: center, uScale: 1, uColor: ink.city, uOpacity: 1 })
      draw(gl, buffers.dots[i]!, gl.TRIANGLES)
    })

    // Then what's see-through, back to front: the haze (its inside), the land, the arc, the ripples, the stories.
    gl.enable(gl.BLEND)
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
    gl.depthMask(false)
    gl.cullFace(gl.FRONT)
    use(ready.air, { uColor: ink.air })
    draw(gl, buffers.air, gl.TRIANGLES)
    gl.cullFace(gl.BACK)
    use(ready.land, { uSize: 0.0072, uScale: landScale, uLand: ink.land, uFaint: mix(ink.sea, ink.land, 0.35) })
    draw(gl, buffers.land, gl.POINTS)
    use(ready.arc, { uTime: time, uProgress: still ? 1 : Math.min(1, since / 1400), uPulse: still ? 0 : 1, uFrom: ink.from, uTo: ink.to })
    draw(gl, buffers.arc, gl.TRIANGLES)
    cities.forEach(({ center }, i) => {
      // A ring rippling out from the city (still, when the page should keep still).
      const t = still ? 0 : (now / 1800 + i * 0.5) % 1
      use(ready.mark, { uCenter: center, uScale: 1 + 1.8 * t, uColor: ink.city, uOpacity: 1 - t })
      draw(gl, buffers.rings[i]!, gl.TRIANGLES)
    })
    use(ready.story, { uSize: 7, uRatio: ratio, uDot: ink.dot, uHot: ink.city, uHalo: ink.halo, uFade: still ? 1 : Math.min(1, since / 900) })
    draw(gl, buffers.stories, gl.POINTS)
  }

  // --- The loop (paused while out of sight, or covered) ---
  let tick = 0
  let last = began
  let paused = false
  let visible = true
  let shown = false
  const loop = (now: number) => {
    tick = requestAnimationFrame(loop)
    const ms = Math.min(100, Math.max(0, now - last))
    last = now
    if (broken) {
      // The graphics card couldn't take the globe: the host's own words say where the stories happened.
      dispose()
      return
    }
    if (flight) {
      const t = Math.min(1, (now - flight.start) / flight.duration)
      const e = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2
      const d0 = length(flight.from)
      const d1 = length(flight.to)
      view.position = scale(slerp(normalize(flight.from), normalize(flight.to), e), d0 + (d1 - d0) * e)
      if (t >= 1) {
        flight = null
        view.update(0)
      }
    } else {
      view.autoRotate = embed && !still && !pointerInside && !hot && now > resume
      view.update(ms)
    }
    // The shaders compile in the background; until they're done there's nothing to show (not even labels).
    if (!programs()) return
    aim()
    placeAll()
    render(now)
    if (!shown) {
      shown = true
      stage.classList.add('is-ready')
    }
    // Holding still (reduced motion, low battery), there's nothing new to draw once it has stopped
    // moving: rest until something could change it (a pointer, a story lit up, a turn, a resize).
    if (still && !flight && !view.moving && !hotChanged) {
      cancelAnimationFrame(tick)
      tick = 0
    }
  }
  const play = () => {
    cancelAnimationFrame(tick)
    tick = 0
    if (visible && !paused) {
      last = performance.now()
      tick = requestAnimationFrame(loop)
    }
  }
  /** Draws again if it was resting. */
  const wake = () => {
    if (!tick) play()
  }
  for (const type of ['pointerdown', 'pointermove', 'wheel'] as const) canvas.addEventListener(type, wake, { signal, passive: true })
  const sight = new IntersectionObserver(([entry]) => {
    visible = !!entry?.isIntersecting
    play()
  })
  sight.observe(host)
  play()

  const dispose = (keep?: (canvas: HTMLCanvasElement, done: () => void) => void) => {
    cancelAnimationFrame(tick)
    controller.abort()
    sight.disconnect()
    resizes.disconnect()
    const lose = () => {
      release()
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
    if (keep && width && shown) {
      // The last frame, kept (snapshotted straight after drawing, before the browser clears it).
      // The graphics card is let go once the picture has taken the canvas's place.
      setHot(null)
      aim()
      placeAll()
      render(performance.now())
      keep(canvas, lose)
      return
    }
    stage.remove()
    host.classList.remove('is-live')
    lose()
  }

  return {
    pause(on) {
      paused = on
      play()
    },
    dispose,
  }
}

let built: ReturnType<typeof build> | null = null

/** Everything but the stories is the same on every globe: built on the first one, then shared. */
const earth = () => (built ??= build())

function build() {
  const cities = Object.values(CITIES).map((city) => ({ center: scale(toVector(city.lat, city.lng), 1.003) }))
  const from = toVector(CITIES.kuwait.lat, CITIES.kuwait.lng)
  const to = toVector(CITIES.toronto.lat, CITIES.toronto.lng)
  return {
    cities,
    ocean: sphere(0.994, 96, 64),
    air: sphere(1.07, 64, 48),
    land: { positions: landPoints(land) },
    arc: tube((t) => scale(slerp(from, to, t), 1 + ARC_HEIGHT * Math.sin(Math.PI * t)), cross(from, to), 192, 0.0045, 8),
    dots: cities.map(({ center }) => mark(center, 0, 0.012, 24)),
    rings: cities.map(({ center }) => mark(center, 0.016, 0.02, 48)),
  }
}

/** The globe's colours, from the host's CSS custom properties (resolved by the browser, so any CSS colour works). */
function colours(host: HTMLElement) {
  const probe = document.createElement('span')
  probe.hidden = true
  host.append(probe)
  const read = (name: string, fallback: string) => {
    probe.style.color = fallback
    probe.style.color = `var(${name}, ${fallback})`
    return rgb(getComputedStyle(probe).color)
  }
  const ink = {
    sea: read('--globe-sea', '#020d0a'),
    land: read('--globe-land', '#709e81'),
    air: read('--globe-air', '#30a67f'),
    dot: read('--globe-dot', '#e8efeb'),
    halo: read('--globe-halo', '#00050b'),
    city: read('--globe-city', '#fc7813'),
    from: read('--globe-from', '#fc8c02'),
    to: read('--globe-to', '#f4460a'),
  }
  probe.remove()
  return ink
}

// --- Shaders (GLSL ES 1.0, so WebGL 1 and 2 both run them) ---

/** Fragment shaders run at high precision where the device has it. */
const PRECISION = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`

const CAMERA = /* glsl */ `
uniform mat4 uView;
uniform mat4 uProjection;
`

/** For spheres: how directly each point faces the camera. */
const FACING_VERTEX = /* glsl */ `${CAMERA}
uniform mat3 uNormalMatrix;
attribute vec3 position;
attribute vec3 normal;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vec4 mv = uView * vec4(position, 1.0);
  vNormal = normalize(uNormalMatrix * normal);
  vView = normalize(-mv.xyz);
  gl_Position = uProjection * mv;
}`

/** The sea, tinted towards the edge. */
const OCEAN_FRAGMENT = /* glsl */ `${PRECISION}
uniform vec3 uSea;
uniform vec3 uRim;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  float edge = 1.0 - max(dot(vNormal, vView), 0.0);
  gl_FragColor = vec4(mix(uSea, uRim, pow(edge, 3.0)), 1.0);
}`

/** The haze around the edge (drawn on the inside of a slightly bigger sphere). */
const AIR_FRAGMENT = /* glsl */ `${PRECISION}
uniform vec3 uColor;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  float glow = pow(max(0.0, 0.7 + dot(vNormal, vView)), 4.0);
  gl_FragColor = vec4(uColor, glow * 0.5);
}`

/** The land: round dots, sized in world units, strongest where they face the camera. */
const LAND_VERTEX = /* glsl */ `${CAMERA}
uniform mat3 uNormalMatrix;
uniform float uSize;
uniform float uScale;
attribute vec3 position;
varying float vFacing;
void main() {
  vec4 mv = uView * vec4(position, 1.0);
  vFacing = dot(normalize(uNormalMatrix * position), normalize(-mv.xyz));
  gl_PointSize = uSize * uScale / -mv.z;
  gl_Position = uProjection * mv;
}`

const LAND_FRAGMENT = /* glsl */ `${PRECISION}
uniform vec3 uLand;
uniform vec3 uFaint;
varying float vFacing;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float alpha = smoothstep(0.5, 0.3, d) * smoothstep(-0.05, 0.3, vFacing);
  gl_FragColor = vec4(mix(uFaint, uLand, smoothstep(0.1, 0.9, vFacing)), alpha);
}`

/** A story's dot: the same size on screen at any distance, ringed in the background's colour so it reads over the land. */
const STORY_VERTEX = /* glsl */ `${CAMERA}
uniform mat3 uNormalMatrix;
uniform float uSize;
uniform float uRatio;
attribute vec3 position;
attribute float hot;
varying float vFacing;
varying float vHot;
void main() {
  vec4 mv = uView * vec4(position, 1.0);
  vFacing = dot(normalize(uNormalMatrix * normalize(position)), normalize(-mv.xyz));
  vHot = hot;
  gl_PointSize = (uSize + hot * 4.0) * uRatio;
  gl_Position = uProjection * mv;
}`

const STORY_FRAGMENT = /* glsl */ `${PRECISION}
uniform vec3 uDot;
uniform vec3 uHot;
uniform vec3 uHalo;
uniform float uFade;
varying float vFacing;
varying float vHot;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float core = smoothstep(0.66, 0.54, d);
  vec3 color = mix(uHalo, mix(uDot, uHot, vHot), core);
  float alpha = smoothstep(1.0, 0.86, d) * smoothstep(0.0, 0.2, vFacing) * uFade;
  gl_FragColor = vec4(color, alpha);
}`

/** The arc: from the amber at Kuwait City to the flame at Toronto, drawn in as it grows, a pulse running along it. */
const ARC_VERTEX = /* glsl */ `${CAMERA}
attribute vec3 position;
attribute float along;
varying float vT;
void main() {
  vT = along;
  gl_Position = uProjection * uView * vec4(position, 1.0);
}`

const ARC_FRAGMENT = /* glsl */ `${PRECISION}
uniform float uTime;
uniform float uProgress;
uniform float uPulse;
uniform vec3 uFrom;
uniform vec3 uTo;
varying float vT;
void main() {
  if (vT > uProgress) discard;
  float head = fract(uTime * 0.16);
  float pulse = uPulse * smoothstep(0.1, 0.0, abs(vT - head));
  gl_FragColor = vec4(mix(uFrom, uTo, vT) + pulse * 0.45, 0.85 + pulse * 0.15);
}`

/** A city's dot and its ring: flat marks in one colour (the ring grows and fades as it ripples). */
const MARK_VERTEX = /* glsl */ `${CAMERA}
uniform vec3 uCenter;
uniform float uScale;
attribute vec3 position;
void main() {
  gl_Position = uProjection * uView * vec4(uCenter + position * uScale, 1.0);
}`

const MARK_FRAGMENT = /* glsl */ `${PRECISION}
uniform vec3 uColor;
uniform float uOpacity;
void main() {
  gl_FragColor = vec4(uColor, uOpacity);
}`

const SHADERS = {
  ocean: [FACING_VERTEX, OCEAN_FRAGMENT],
  air: [FACING_VERTEX, AIR_FRAGMENT],
  land: [LAND_VERTEX, LAND_FRAGMENT],
  story: [STORY_VERTEX, STORY_FRAGMENT],
  arc: [ARC_VERTEX, ARC_FRAGMENT],
  mark: [MARK_VERTEX, MARK_FRAGMENT],
} as const

const UNIFORMS: Record<keyof typeof SHADERS, string[]> = {
  ocean: ['uView', 'uProjection', 'uNormalMatrix', 'uSea', 'uRim'],
  air: ['uView', 'uProjection', 'uNormalMatrix', 'uColor'],
  land: ['uView', 'uProjection', 'uNormalMatrix', 'uSize', 'uScale', 'uLand', 'uFaint'],
  story: ['uView', 'uProjection', 'uNormalMatrix', 'uSize', 'uRatio', 'uDot', 'uHot', 'uHalo', 'uFade'],
  arc: ['uView', 'uProjection', 'uTime', 'uProgress', 'uPulse', 'uFrom', 'uTo'],
  mark: ['uView', 'uProjection', 'uCenter', 'uScale', 'uColor', 'uOpacity'],
}
