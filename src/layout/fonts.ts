// Font specs shared by CSS and pretext. pretext measures with canvas, so the
// canvas font string must describe exactly what the CSS renders.
import { clearCache } from '@chenglou/pretext'

export const FAMILY = {
  display: '"Fraunces Variable"',
  text: '"Newsreader Variable"',
  mono: '"IBM Plex Mono"',
} as const

export interface FontSpec {
  family: string
  weight: number
  /** px */
  size: number
  italic?: boolean
  /** CSS letter-spacing in em (converted to px at this size). */
  tracking?: number
}

export const canvasFont = (f: FontSpec) => `${f.italic ? 'italic ' : ''}${f.weight} ${f.size}px ${f.family}`
export const trackingPx = (f: FontSpec) => (f.tracking ?? 0) * f.size

// pretext measures on a canvas of its own, and a canvas's default kerning
// ('auto') can skip kerning at small sizes, while the page always kerns
// (base.css: text-rendering: optimizeLegibility). In small text that made
// pretext's words drift up to a few px from where the browser draws them.
// pretext creates its canvas lazily, on first measurement, so from here on
// every measuring canvas is created kerning like the page.
if (typeof OffscreenCanvas !== 'undefined') {
  const getContext = OffscreenCanvas.prototype.getContext as (this: OffscreenCanvas, ...args: unknown[]) => unknown
  OffscreenCanvas.prototype.getContext = function (this: OffscreenCanvas, ...args: unknown[]) {
    const ctx = getContext.apply(this, args)
    if (ctx instanceof OffscreenCanvasRenderingContext2D) ctx.fontKerning = 'normal'
    return ctx
  } as typeof OffscreenCanvas.prototype.getContext
}

/** Applies a FontSpec to an element's inline style (pretext-drawn text must match its measurement). */
export function applyFont(el: HTMLElement, f: FontSpec, lineHeight: number) {
  el.style.font = canvasFont(f)
  el.style.lineHeight = `${lineHeight}px`
  el.style.letterSpacing = f.tracking ? `${trackingPx(f)}px` : ''
}

// Characters beyond basic Latin that appear in the content. Asking for them
// up front makes the browser fetch every unicode-range subset we need
// before anything is measured.
const SAMPLE = 'Aa0 é–—“”‘’→×°·…βα√'

let ready: Promise<boolean> | undefined

/**
 * Resolves true once the web fonts are loaded and safe to measure, or false
 * if this browser can't run pretext (no Intl.Segmenter), in which case every
 * layout falls back to plain CSS.
 */
export function fontsReady(): Promise<boolean> {
  ready ??= (async () => {
    if (typeof Intl === 'undefined' || !('Segmenter' in Intl) || !document.fonts) return false
    const probes: FontSpec[] = [
      { family: FAMILY.text, weight: 400, size: 16 },
      { family: FAMILY.text, weight: 400, size: 16, italic: true },
      { family: FAMILY.display, weight: 700, size: 24 },
      { family: FAMILY.display, weight: 800, size: 24 },
      { family: FAMILY.mono, weight: 500, size: 11 },
    ]
    try {
      await Promise.all(probes.map((f) => document.fonts.load(canvasFont(f), SAMPLE)))
      await document.fonts.ready
    } catch {
      return false
    }
    // Anything measured before the fonts arrived was measured in a fallback font.
    clearCache()
    return true
  })()
  return ready
}
