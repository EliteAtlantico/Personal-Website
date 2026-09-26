// What the site says about personalizing, as plain data so the paper and the
// terminal say the same thing: the editor's note at the top of the front
// page, what changed, and every signal the browser shared (the paper's
// "see everything" panel, and whoami in the terminal).
import type { Signals } from './collect'
import type { Decision, Persona } from './decide'

/** Buttons the note offers: open the panel, turn personalizing off or back on, or answer the question. */
export type Action = 'panel' | 'off' | 'on' | 'yes' | 'no'

export interface Note {
  /** A word or two in front, like a kicker ("Up late?"). */
  hello?: string
  text: string
  /** Link to the résumé at the end of the text (recruiters). */
  resume: boolean
  actions: Action[]
}

const WHO: Record<Persona, string> = { recruiter: 'recruiters', research: 'labs', dev: 'developers' }
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const ASK = 'This page can also put what matters to you first, using what your browser shares (your system, fonts and time zone). Nothing is kept or sent anywhere. Want that?'

/** The editor's note. `first` is the desk the visitor's kind moved to the top ("Industry"). */
export function note(decision: Decision, signals: Partial<Signals>, first?: string): Note {
  switch (decision.mode) {
    case 'gpc':
      return { text: "Your browser sends Global Privacy Control, so this page didn't read anything about your device and looks the same for everyone. Thanks for having it on.", resume: false, actions: ['panel'] }
    case 'dnt':
      return { text: "Your browser asks sites not to track you, so this page didn't read anything about your device and looks the same for everyone. Thanks for having that on.", resume: false, actions: ['panel'] }
    case 'off':
      return { text: 'You turned personalizing off, so this is the page everyone sees.', resume: false, actions: ['on', 'panel'] }
    case 'ask': {
      const said = decision.persona ? `${because(decision, first)} ` : ''
      return { text: `${said}${decision.persona ? ASK : ASK.replace('also ', '')}`, resume: decision.persona === 'recruiter', actions: ['yes', 'no', 'panel'] }
    }
  }
  const parts: string[] = []
  if (decision.persona) parts.push(because(decision, first))
  if (decision.place === 'kuwait') parts.push(`You're ${decision.persona ? 'also ' : ''}on Kuwait time, so the Kuwait stories come first in each section.`)
  if (decision.light === 'battery') parts.push(`Your battery is at ${Math.round((signals.battery?.level ?? 0) * 100)}%, so the animations are off.`)
  if (decision.light === 'data') parts.push('Your browser asked to save data, so the videos and animations are off.')
  if (!parts.length) parts.push('This front page reorders itself for recruiters, labs and developers. Nothing about your visit changed it.')
  return { hello: decision.late ? 'Up late?' : undefined, text: parts.join(' '), resume: decision.persona === 'recruiter', actions: ['panel', 'off'] }
}

/** "You came from LinkedIn, so Industry is first today and my résumé is one click away." */
function because(decision: Decision, first = 'that section') {
  switch (decision.persona) {
    case 'recruiter':
      return `${decision.why}, so ${first} is first today and my résumé is one click away.`
    case 'research':
      return `${decision.why}, so ${first.toLowerCase()} comes first today.`
    default:
      return `${decision.why}, so ${first.toLowerCase()} come first today.`
  }
}

/** What personalizing changed, one line each (for the panel and whoami). */
export function changes(decision: Decision, first?: string, terminal = false): string[] {
  const out: string[] = []
  if (terminal) out.push('Opened the site as a terminal')
  if (decision.persona) {
    if (first) out.push(`Put ${first} first`)
    out.push(`Sorted each section by what ${WHO[decision.persona]} tend to look for`)
    if (decision.persona === 'recruiter') out.push('Put my résumé in the note at the top')
  }
  if (decision.place === 'kuwait') out.push('Moved the stories from Kuwait up')
  if (decision.light) out.push('Turned off the animations and the autoplaying videos')
  if (decision.late) out.push('Asked if you were up late')
  return out
}

export interface Facts {
  group: string
  rows: Array<[label: string, value: string]>
}

/** Everything the browser shared, grouped and in words. Anything not read shows as such. */
export function facts(s: Partial<Signals>): Facts[] {
  const yes = (on?: boolean) => (on === undefined ? 'not read' : on ? 'on' : 'off')
  const read = (value: string | undefined, fallback = 'not read') => value || fallback
  const device = s.os !== undefined || s.browser !== undefined
  return [
    {
      group: 'How you got here',
      rows: [
        ['Came from', s.referrer ?? 'nowhere it would say (a bookmark, a typed address, or a site that keeps it private)'],
        ['Link tag', s.via ? `?via=${s.via}` : 'none'],
      ],
    },
    {
      group: 'Your device',
      rows: [
        ['System', read(s.os, device ? 'unknown' : 'not read')],
        ['Browser', read(s.browser && `${s.browser}${s.browserVersion ? ` ${s.browserVersion}` : ''}`, device ? 'unknown' : 'not read')],
        ['Screen', s.screen ? `${s.screen.width} × ${s.screen.height}, at ${s.screen.dpr}× pixel density` : 'not read'],
        ['Processor', s.cores ? `${s.cores} cores` : 'not read'],
        ['Memory', s.memory ? `${s.memory} GB${s.memory >= 8 ? ' or more (browsers stop counting at 8)' : ''}` : device ? 'not shared by this browser' : 'not read'],
        ['Graphics', read(s.gpu)],
        ['Coding fonts', s.fonts ? (s.fonts.length ? s.fonts.join(', ') : 'none found') : 'not read'],
        ['Touchscreen', s.touch === undefined ? 'not read' : s.touch ? 'yes' : 'no'],
        ['Battery', s.battery ? `${Math.round(s.battery.level * 100)}%${s.battery.charging ? ', charging' : ''}` : device ? 'not shared by this browser' : 'not read'],
      ],
    },
    {
      group: 'Your settings',
      rows: [
        ['Languages', s.languages?.join(', ') || 'not read'],
        ['Theme', s.dark === undefined ? 'not read' : s.dark ? 'dark' : 'light'],
        ['Reduced motion', yes(s.reducedMotion)],
        ['Global Privacy Control', yes(s.gpc)],
        ['Do Not Track', yes(s.dnt)],
        ['Save-Data', yes(s.saveData)],
        ['Connection', read(s.connection, device ? 'not shared by this browser' : 'not read')],
      ],
    },
    {
      group: 'Where and when',
      rows: [
        ['Time zone', read(s.timeZone)],
        ['Local time', s.day !== undefined && s.hour !== undefined ? `${DAYS[s.day]}, around ${s.hour % 12 || 12} ${s.hour < 12 ? 'a.m.' : 'p.m.'}` : 'not read'],
        ['City', read(s.city && [s.city, s.region, s.country].filter(Boolean).join(', '), "not known (Cloudflare didn't say)")],
        ['Network', read(s.org, "not known (Cloudflare didn't say)")],
      ],
    },
  ]
}
