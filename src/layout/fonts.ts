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

let measurer: CanvasRenderingContext2D | null = null

/** A canvas context for measuring text, shared (measuring draws nothing, so its canvas has no pixels). */
export function measuring(): CanvasRenderingContext2D | null {
  if (!measurer) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 0
    measurer = canvas.getContext('2d')
  }
  return measurer
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
const SAMPLE = 'Aa0 é–\u2014“”‘’→×°·…βα√'

/**
 * The fonts a page measures with: the paper's (all three families, since
 * its globe labels are monospaced too), or only the terminal's monospace.
 * These are the files scripts/prerender.ts preloads for each page.
 */
export type FontSet = 'paper' | 'mono'

const PROBES: Record<FontSet, FontSpec[]> = {
  paper: [
    { family: FAMILY.text, weight: 400, size: 16 },
    { family: FAMILY.text, weight: 400, size: 16, italic: true },
    { family: FAMILY.display, weight: 700, size: 24 },
    { family: FAMILY.display, weight: 800, size: 24 },
    { family: FAMILY.mono, weight: 500, size: 11 },
  ],
  mono: [
    { family: FAMILY.mono, weight: 400, size: 14 },
    { family: FAMILY.mono, weight: 500, size: 11 },
  ],
}

const ready = new Map<FontSet, Promise<boolean>>()

/**
 * Resolves true once a page's web fonts are loaded and safe to measure, or
 * false if this browser can't run pretext (no Intl.Segmenter), in which case
 * every layout falls back to plain CSS. The terminal waits for its monospace
 * alone, so it never waits on (or downloads) the paper's serifs.
 */
export function fontsReady(set: FontSet = 'paper'): Promise<boolean> {
  let loaded = ready.get(set)
  if (!loaded) {
    loaded = (async () => {
      if (typeof Intl === 'undefined' || !('Segmenter' in Intl) || !document.fonts) return false
      try {
        await Promise.all(PROBES[set].map((f) => document.fonts.load(canvasFont(f), SAMPLE)))
        await document.fonts.ready
      } catch {
        return false
      }
      // Anything measured before the fonts arrived was measured in a fallback font.
      clearCache()
      return true
    })()
    ready.set(set, loaded)
  }
  return loaded
}
