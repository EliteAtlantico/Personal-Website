// What a visitor's browser tells any site without being asked (see
// neberej.github.io/exposedbydefault), read here so the page can decide what
// to show first. Nothing is stored or sent anywhere: it lives in this tab's
// memory and is gone when the tab closes.
//
// Reading happens in two steps. `basics()` is what every page needs anyway or
// that isn't about the device: where the visitor came from, the ?via= tag on
// the link, the privacy settings they send, and their time zone (to know
// whether to ask first, in Europe). `device()` is the rest (system, fonts,
// hardware, battery), read only when personalizing is allowed.

export interface Signals {
  /** The site that linked here (a hostname), and the ?via= tag on the link. */
  referrer?: string
  via?: string
  /** Global Privacy Control and Do Not Track. */
  gpc: boolean
  dnt: boolean
  timeZone?: string
  languages: string[]
  /** Local time: hour 0–23, day 0 (Sunday) to 6. */
  hour: number
  day: number

  os?: string
  browser?: string
  browserVersion?: string
  mobile?: boolean
  screen?: { width: number; height: number; dpr: number }
  cores?: number
  /** GB, rounded down by the browser. */
  memory?: number
  /** Coding fonts installed on the device. */
  fonts?: string[]
  gpu?: string
  dark?: boolean
  reducedMotion?: boolean
  touch?: boolean
  saveData?: boolean
  connection?: string
  battery?: { level: number; charging: boolean }

  /** What Cloudflare sees of the connection (stage 6, /api/visitor). */
  city?: string
  region?: string
  country?: string
  org?: string
  eu?: boolean
}

export type Basics = Pick<Signals, 'referrer' | 'via' | 'gpc' | 'dnt' | 'timeZone' | 'languages' | 'hour' | 'day'>

export function basics(): Basics {
  const params = new URLSearchParams(location.search)
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean }
  let referrer: string | undefined
  try {
    const from = document.referrer ? new URL(document.referrer) : null
    if (from && from.host !== location.host) referrer = from.hostname.replace(/^www\./, '')
  } catch {
    // Not a URL we can read.
  }
  const now = new Date()
  return {
    referrer,
    via: params.get('via')?.toLowerCase() || undefined,
    gpc: nav.globalPrivacyControl === true,
    dnt: navigator.doNotTrack === '1' || (window as Window & { doNotTrack?: string }).doNotTrack === '1',
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
    languages: [...(navigator.languages?.length ? navigator.languages : [navigator.language])].filter(Boolean),
    hour: now.getHours(),
    day: now.getDay(),
  }
}

/** The device: system, browser, screen, hardware, fonts, settings, connection and battery. */
export async function device(): Promise<Omit<Signals, keyof Basics>> {
  const ua = navigator.userAgent
  const nav = navigator as Navigator & {
    deviceMemory?: number
    connection?: { effectiveType?: string; saveData?: boolean }
    getBattery?: () => Promise<{ level: number; charging: boolean }>
    userAgentData?: { platform?: string; mobile?: boolean }
  }
  const media = (query: string) => matchMedia(query).matches
  const [name, version] = browserOf(ua)
  const battery = await Promise.race([
    nav.getBattery?.().then((b) => ({ level: b.level, charging: b.charging })).catch(() => undefined),
    new Promise<undefined>((resolve) => setTimeout(resolve, 150)),
  ])
  return {
    os: osOf(ua, nav.userAgentData?.platform),
    browser: name,
    browserVersion: version,
    mobile: nav.userAgentData?.mobile ?? /Mobi|Android|iPhone|iPad/.test(ua),
    screen: { width: screen.width, height: screen.height, dpr: Math.round(devicePixelRatio * 100) / 100 },
    cores: navigator.hardwareConcurrency || undefined,
    memory: nav.deviceMemory,
    fonts: codingFonts(),
    dark: media('(prefers-color-scheme: dark)'),
    reducedMotion: media('(prefers-reduced-motion: reduce)'),
    touch: media('(pointer: coarse)'),
    saveData: nav.connection?.saveData === true,
    connection: nav.connection?.effectiveType,
    battery,
  }
}

/** The graphics card, as WebGL reports it. Only read when someone asks to see everything (it's slow-ish). */
export function gpu(): string | undefined {
  try {
    const gl = document.createElement('canvas').getContext('webgl')
    if (!gl) return undefined
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER))
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return chipName(renderer)
  } catch {
    return undefined
  }
}

/**
 * The card's name out of what browsers report: "ANGLE (Apple, ANGLE Metal
 * Renderer: Apple M1, Unspecified Version)" is an Apple M1, and "ANGLE
 * (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)" a GeForce RTX 3080.
 */
export function chipName(renderer: string): string | undefined {
  const parts = renderer
    .replace(/^ANGLE \((.*)\)$/, '$1')
    .split(', ')
    .map((part) => part.replace(/^.*Renderer: /, '').replace(/ (?:Direct3D|vs_|ps_|OpenGL|Vulkan|\(0x).*$/, '').trim())
  const named = parts.filter((part) => part && !/^(?:D3D\d*|OpenGL.*|Vulkan.*|Metal|Unspecified Version|or similar|Apple|NVIDIA|AMD|ATI|Intel|Google|Qualcomm|ARM)$/i.test(part))
  return [...named].sort((a, b) => b.length - a.length)[0] ?? (parts[0] || undefined)
}

declare global {
  interface Window {
    /** /api/visitor's answer, asked for by the page's inline script (index.html) as soon as the page starts loading. */
    __visitor?: Promise<Record<string, unknown>>
  }
}

let visitor: Promise<Record<string, unknown>> | undefined

/** What the edge worker says about this visit, asked once: usually already on its way (see index.html). */
function askEdge() {
  visitor ??=
    window.__visitor ??
    fetch('/api/visitor', { headers: { accept: 'application/json' } })
      .then((response) => (response.ok && response.headers.get('content-type')?.includes('json') ? (response.json() as Promise<Record<string, unknown>>) : {}))
      .catch(() => ({}))
  return visitor
}

/** What Cloudflare saw (city, network), from the edge worker (edge/worker.ts). Never waited on for more than 400 ms. */
export async function network(): Promise<Pick<Signals, 'city' | 'region' | 'country' | 'org' | 'eu'>> {
  const data = await Promise.race([askEdge(), new Promise<Record<string, unknown>>((resolve) => setTimeout(() => resolve({}), 400))])
  const text = (key: string) => (typeof data[key] === 'string' && data[key] ? (data[key] as string) : undefined)
  return { city: text('city'), region: text('region'), country: text('country'), org: text('org'), eu: data.eu === true }
}

export function osOf(ua: string, platform?: string): string | undefined {
  const named: Record<string, string> = { Linux: 'Linux', macOS: 'macOS', Windows: 'Windows', Android: 'Android', 'Chrome OS': 'ChromeOS', ChromeOS: 'ChromeOS', iOS: 'iOS' }
  if (platform && named[platform]) return named[platform]
  if (/Android/.test(ua)) return 'Android'
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS'
  if (/CrOS/.test(ua)) return 'ChromeOS'
  if (/Windows/.test(ua)) return 'Windows'
  // iPads ask for the desktop site and say they're Macs; a touchscreen gives them away.
  if (/Mac OS X|Macintosh/.test(ua)) return typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1 ? 'iOS' : 'macOS'
  if (/Linux|X11/.test(ua)) return 'Linux'
  return undefined
}

export function browserOf(ua: string): [string | undefined, string | undefined] {
  const match = (re: RegExp) => re.exec(ua)?.[1]
  const tests: Array<[string, RegExp]> = [
    ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/],
    ['Edge', /Edg(?:e|A|iOS)?\/(\d+)/],
    ['Opera', /(?:OPR|Opera)\/(\d+)/],
    ['Chrome', /(?:Chrome|CriOS)\/(\d+)/],
    ['Safari', /Version\/(\d+)(?:\.\d+)* (?:Mobile\/\S+ )?Safari/],
  ]
  for (const [name, re] of tests) {
    const version = match(re)
    if (version) return [name, version]
  }
  return [undefined, undefined]
}

/**
 * Which coding fonts are installed, found the classic way: text set in the
 * font measures differently from the same text in the browser's fallback.
 * (IBM Plex Mono is left out: this site loads it itself.)
 */
function codingFonts(): string[] {
  const candidates = [
    'JetBrains Mono',
    'JetBrainsMono Nerd Font',
    'Fira Code',
    'FiraCode Nerd Font',
    'Cascadia Code',
    'Cascadia Mono',
    'Source Code Pro',
    'Hack',
    'Iosevka',
    'Victor Mono',
    'Monaspace Neon',
    'Berkeley Mono',
    'Ubuntu Mono',
    'Inconsolata',
    'Hasklig',
    'Input Mono',
    'Operator Mono',
  ]
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) return []
  const sample = 'mmmmmmmmmmlli10OO@#{}'
  const width = (font: string) => {
    ctx.font = `72px ${font}`
    return ctx.measureText(sample).width
  }
  const bases = ['monospace', 'serif', 'sans-serif'].map((base) => [base, width(base)] as const)
  return candidates.filter((name) => bases.some(([base, w]) => width(`"${name}", ${base}`) !== w))
}
