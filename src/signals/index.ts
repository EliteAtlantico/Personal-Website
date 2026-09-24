// Personalizing, start to finish: read the signals, decide, and lay out the
// site for this visitor (an "edition" of the paper). Runs once per page load,
// before the first page is shown, and again if the visitor changes their mind.
//
// For testing, ?debug pretends to be someone else: any signal can be set from
// the URL (?debug&os=Linux&browser=Firefox, &ref=linkedin.com, &tz=Asia/Kuwait,
// &org=University of Toronto, &battery=0.1, &gpc=1 …), and stored choices are
// ignored unless given too (&personalize=1, &view=paper).
import type { Site } from '../content/types'
import { basics, device, gpu, network, type Signals } from './collect'
import { decide, type Decision, type Prefs } from './decide'
import { firstDesk, personalizeSite } from './apply'
import { forgetPrefs, readPrefs, writePrefs } from './prefs'

export interface Edition {
  /** The site laid out for this visitor. */
  site: Site
  decision: Decision
  signals: Partial<Signals>
  /** The desk this visitor's kind moved to the top, by name. */
  first?: string
  /** The terminal was opened because of the visitor (not asked for by URL or by them). */
  terminal: boolean
  debug: boolean
}

let current: Edition | undefined
let base: Site | undefined
let overrides: ReturnType<typeof debugOverrides>
/** The visitor's own choices: from their browser's storage, or from the URL when debugging. */
let choices: Prefs = {}

/** This visit's edition (after `personalize` has run). */
export const edition = () => current

/**
 * Whether to keep things still: the visitor asked for reduced motion, or
 * personalizing turned the animations off (low battery, Save-Data).
 */
export const calm = () => !!current?.decision.light || matchMedia('(prefers-reduced-motion: reduce)').matches

export async function personalize(site: Site): Promise<Edition> {
  base = site
  overrides = debugOverrides()
  choices = overrides ? overrides.prefs : readPrefs()
  return build()
}

/**
 * The visitor made a choice (personalizing on or off, a view). It's kept in
 * their browser (not while debugging) and, if it changes what personalizing
 * does, the edition is worked out again and announced (a "kc:edition" event,
 * which the router redraws the page for).
 */
export async function choose(change: Prefs): Promise<Edition | undefined> {
  choices = { ...choices, ...change }
  if (!overrides) writePrefs(change)
  if (!base || !('personalize' in change)) return current
  return announce(await build(current))
}

/** Forgets every choice the visitor made here, and works the edition out again without them. */
export async function forget(): Promise<Edition | undefined> {
  choices = {}
  forgetPrefs()
  return base ? announce(await build(current)) : current
}

function announce(next: Edition) {
  document.dispatchEvent(new CustomEvent<Edition>('kc:edition', { detail: next }))
  return next
}

async function build(before?: Edition): Promise<Edition> {
  const prefs = choices
  // What every page reads (the link that brought them, their privacy settings, time zone),
  // then what the network says (which is also how we know they're in Europe).
  let signals: Partial<Signals> = { ...basics(), ...(await network()), ...overrides?.signals }
  let decision = decide(signals, prefs)
  // The device itself, only once personalizing is allowed.
  if (decision.mode === 'on') {
    signals = { ...signals, ...(await device()), ...overrides?.signals }
    decision = decide(signals, prefs)
  }
  const site = personalizeSite(base!, decision)
  current = {
    site,
    decision,
    signals,
    first: decision.persona ? firstDesk(site, decision) : undefined,
    terminal: before?.terminal ?? false,
    debug: !!overrides,
  }
  return current
}

/** Marks that the terminal was opened because of the visitor's signals. */
export function openedAsTerminal() {
  if (current) current.terminal = true
}

/**
 * What's been read so far, plus the graphics card, which is only read when
 * someone asks to see it (whoami). Nothing new about the device otherwise.
 */
export function seen(): Partial<Signals> {
  if (current && current.signals.os !== undefined) current.signals.gpu ??= overrides?.signals.gpu ?? gpu()
  return current?.signals ?? basics()
}

/**
 * Everything the browser shares, read now if it wasn't before, because the
 * visitor asked to see it (the panel). Showing isn't using: the page doesn't
 * change because of anything read here.
 */
export async function everything(): Promise<Partial<Signals>> {
  const signals: Partial<Signals> = { ...(current?.signals ?? basics()) }
  if (signals.os === undefined) Object.assign(signals, await device(), overrides?.signals)
  signals.gpu ??= overrides?.signals.gpu ?? gpu()
  if (current) current.signals = { ...current.signals, gpu: signals.gpu }
  return signals
}

/** ?debug: signals and choices from the URL, to try the site as someone else. */
function debugOverrides() {
  const params = new URLSearchParams(location.search)
  if (!params.has('debug')) return undefined
  const text = (key: string) => params.get(key) || undefined
  const num = (key: string) => (params.has(key) && params.get(key) !== '' && !Number.isNaN(Number(params.get(key))) ? Number(params.get(key)) : undefined)
  const flag = (key: string) => (params.has(key) ? params.get(key) !== '0' && params.get(key) !== 'false' : undefined)
  const battery = num('battery')
  const signals: Partial<Signals> = {
    referrer: text('ref')?.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0],
    os: text('os'),
    browser: text('browser'),
    browserVersion: text('version'),
    timeZone: text('tz'),
    languages: text('lang')?.split(','),
    hour: num('hour'),
    day: num('day'),
    fonts: params.has('fonts') ? (text('fonts')?.split(',').map((f) => f.trim()).filter(Boolean) ?? []) : undefined,
    battery: battery === undefined ? undefined : { level: battery > 1 ? battery / 100 : battery, charging: flag('charging') ?? false },
    saveData: flag('savedata'),
    gpc: flag('gpc'),
    dnt: flag('dnt'),
    org: text('org'),
    city: text('city'),
    country: text('country'),
    eu: flag('eu'),
    gpu: text('gpu'),
    touch: flag('touch'),
  }
  for (const key of Object.keys(signals) as Array<keyof Signals>) if (signals[key] === undefined) delete signals[key]
  const view = text('view')
  const prefs: Prefs = { personalize: flag('personalize'), view: view === 'paper' || view === 'terminal' ? view : undefined }
  return { signals, prefs }
}
