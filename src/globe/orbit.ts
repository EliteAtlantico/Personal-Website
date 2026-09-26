// The camera around the globe, as three.js's OrbitControls moved it: drag to
// turn it (it keeps a little momentum), a slow turn by itself, and in full
// screen, the wheel or a pinch to come closer. The camera always looks at the
// globe's centre, from a point given by its distance and two angles.
import type { Vec3 } from './gl'

export interface OrbitOptions {
  /** Where turning is felt: the canvas. */
  element: HTMLElement
  signal: AbortSignal
  zoom: boolean
  minDistance: number
  maxDistance: number
  zoomSpeed: number
  /** How much of the remaining turn is used up each frame (the momentum). */
  damping: number
  /** Turns per minute (roughly: 1 is a turn a minute at 60 frames a second, as three.js had it). */
  autoRotateSpeed: number
}

export interface Orbit {
  /** The camera's position; set it to move the camera (the angles follow from it). */
  position: Vec3
  autoRotate: boolean
  /** A pointer is turning the globe. */
  readonly dragging: boolean
  /** Still turning: a pointer is on it, or its momentum or a zoom hasn't died down. */
  readonly moving: boolean
  /** One step: momentum, the slow turn (ms since the last step) and zoom. */
  update(ms?: number): void
}

const EPS = 0.000001
const FRAME = 1000 / 60

export function orbit(options: OrbitOptions): Orbit {
  const { element, signal, damping } = options
  let theta = 0
  let phi = 0
  let radius = 1
  let dTheta = 0
  let dPhi = 0
  let zoom = 1
  const pointers = new Map<number, { x: number; y: number }>()
  let last: { x: number; y: number } | null = null
  let spread = 0

  const self: Orbit = {
    position: [0, 0, 1],
    autoRotate: false,
    get dragging() {
      return pointers.size > 0
    },
    get moving() {
      return pointers.size > 0 || Math.abs(dTheta) > 1e-5 || Math.abs(dPhi) > 1e-5 || zoom !== 1
    },
    update(ms = FRAME) {
      // Where the camera is now (it may have been moved), as a distance and two angles.
      const [x, y, z] = self.position
      radius = Math.hypot(x, y, z)
      theta = radius ? Math.atan2(x, z) : 0
      phi = radius ? Math.acos(Math.min(1, Math.max(-1, y / radius))) : 0
      if (self.autoRotate && !pointers.size) dTheta -= ((2 * Math.PI) / 60 / 60) * options.autoRotateSpeed * (ms / FRAME)
      theta += dTheta * damping
      phi = Math.min(Math.PI - EPS, Math.max(EPS, phi + dPhi * damping))
      radius = Math.min(options.maxDistance, Math.max(options.minDistance, radius * zoom))
      const across = Math.sin(phi) * radius
      self.position = [across * Math.sin(theta), Math.cos(phi) * radius, across * Math.cos(theta)]
      dTheta *= 1 - damping
      dPhi *= 1 - damping
      zoom = 1
    },
  }

  /** Dragging by the element's height turns the globe all the way round. */
  const turn = (dx: number, dy: number) => {
    const height = element.clientHeight || 1
    dTheta -= (2 * Math.PI * dx) / height
    dPhi -= (2 * Math.PI * dy) / height
    self.update(0)
  }
  const center = () => {
    let x = 0
    let y = 0
    for (const p of pointers.values()) {
      x += p.x / pointers.size
      y += p.y / pointers.size
    }
    return { x, y }
  }
  const distance = () => {
    const [a, b] = [...pointers.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }

  element.addEventListener(
    'pointerdown',
    (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      if (!pointers.size) {
        try {
          element.setPointerCapture(event.pointerId)
        } catch {
          // A pointer that can't be captured still turns the globe while it's over it.
        }
      }
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      last = center()
      spread = distance()
    },
    { signal },
  )
  element.addEventListener(
    'pointermove',
    (event) => {
      if (!pointers.has(event.pointerId)) return
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (pointers.size === 2) {
        // Two fingers: pinch to come closer (full screen), and no turning.
        if (!options.zoom) return
        const now = distance()
        if (spread && now) {
          zoom /= (now / spread) ** options.zoomSpeed
          self.update(0)
        }
        spread = now
        return
      }
      const now = center()
      if (last) turn(now.x - last.x, now.y - last.y)
      last = now
    },
    { signal },
  )
  const up = (event: PointerEvent) => {
    if (!pointers.delete(event.pointerId)) return
    if (!pointers.size) {
      try {
        element.releasePointerCapture(event.pointerId)
      } catch {
        // Already released.
      }
    }
    last = pointers.size ? center() : null
    spread = distance()
  }
  element.addEventListener('pointerup', up, { signal })
  element.addEventListener('pointercancel', up, { signal })
  element.addEventListener('contextmenu', (event) => event.preventDefault(), { signal })

  if (options.zoom) {
    element.addEventListener(
      'wheel',
      (event) => {
        if (pointers.size) return
        event.preventDefault()
        // Lines and pages to pixels, and a trackpad pinch (a wheel with ctrl) counts for more, as three.js had it.
        let dy = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1)
        if (event.ctrlKey) dy *= 10
        const step = 0.95 ** (options.zoomSpeed * Math.abs(dy * 0.01))
        if (dy < 0) zoom *= step
        else if (dy > 0) zoom /= step
        self.update(0)
      },
      { signal, passive: false },
    )
  }
  return self
}
