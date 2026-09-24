// Who's visiting (as far as their browser lets on) and what that changes.
// A pure function of the signals (collect.ts) and the visitor's own choices,
// so every kind of visitor can be tested (decide.test.ts).
//
// Three kinds of visitor get scored; the highest score of 3 or more wins, and
// a tie goes to whoever's likelier to be hiring (recruiter, then research,
// then dev), since they're the ones the paper is laid out for.
import type { Signals } from './collect'

export type Persona = 'recruiter' | 'research' | 'dev'
/** Only Kuwait: the paper is already Toronto-first for everyone. */
export type Place = 'kuwait'
export type View = 'paper' | 'terminal'

/** Choices the visitor made themselves, kept in their browser (prefs.ts). */
export interface Prefs {
  /** false: never personalize. true: yes, asked for (in Europe). */
  personalize?: boolean
  /** The view they last switched to. */
  view?: View
}

export interface Decision {
  /**
   * on: personalized. off: the visitor turned it off. gpc/dnt: their browser
   * asks not to be tracked. ask: in Europe, and they haven't said yes yet
   * (only the referrer and the link's ?via= tag count until they do).
   */
  mode: 'on' | 'off' | 'gpc' | 'dnt' | 'ask'
  persona?: Persona
  scores: Record<Persona, number>
  /** Why the persona won, in words: "You came from LinkedIn". */
  why?: string
  place?: Place
  /** Where to start when landing on the front page. */
  view: View
  /** The visitor picked the view themselves (so it isn't personalization). */
  chosen: boolean
  /** Low battery or Save-Data: no animations and no autoplaying video. */
  light?: 'battery' | 'data'
  /** After midnight, before 5. */
  late: boolean
}

const DEV_SITES = /(^|\.)(github\.com|gitlab\.com|codeberg\.org|news\.ycombinator\.com|lobste\.rs|stackoverflow\.com|stackexchange\.com|dev\.to)$/
const HIRING_SITES = /(^|\.)(linkedin\.com|lnkd\.in|indeed\.com|glassdoor\.[a-z.]+|greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|joinhandshake\.com|wellfound\.com)$/
const RESEARCH_SITES =
  /(^|\.)(scholar\.google\.[a-z.]+|arxiv\.org|openreview\.net|semanticscholar\.org|researchgate\.net|orcid\.org|ieeexplore\.ieee\.org|dl\.acm\.org|[a-z0-9-]+\.edu|[a-z0-9-]+\.ac\.[a-z]{2}|utoronto\.ca|uwaterloo\.ca|mcgill\.ca|ubc\.ca)$/

const VIA: Record<Persona, string[]> = {
  dev: ['dev', 'developer', 'code', 'github', 'hn'],
  recruiter: ['recruiter', 'recruiting', 'hire', 'hiring', 'job', 'jobs', 'career', 'careers', 'linkedin', 'resume', 'cv'],
  research: ['lab', 'labs', 'research', 'phd', 'academic', 'prof', 'scholar'],
}

const UNIVERSITY = /universit|college|polytechni|institute of technology|school of|academ|research council|laborator/i
/** Networks that say nothing about who's on them: home and mobile internet, clouds, VPNs. */
const PROVIDER =
  /telecom|communications|cable|broadband|mobile|wireless|internet|\bisp\b|comcast|verizon|at&t|t-mobile|sprint|charter|spectrum|\bcox\b|frontier|centurylink|lumen|rogers|bell canada|telus|shaw|videotron|cogeco|fizz|vodafone|orange|\bbt\b|virgin|telstra|optus|zain|ooredoo|\bstc\b|kuwait telecom|starlink|cloudflare|amazon|google|microsoft|digitalocean|hetzner|ovh|linode|akamai|fastly|oracle|alibaba|tencent|proton|mullvad|nord/i

/** Friendly names for the sites people come from. */
const SITE_NAMES: Record<string, string> = {
  'linkedin.com': 'LinkedIn',
  'lnkd.in': 'LinkedIn',
  'github.com': 'GitHub',
  'gitlab.com': 'GitLab',
  'news.ycombinator.com': 'Hacker News',
  'lobste.rs': 'Lobsters',
  'stackoverflow.com': 'Stack Overflow',
  'scholar.google.com': 'Google Scholar',
  'arxiv.org': 'arXiv',
  'openreview.net': 'OpenReview',
  'utoronto.ca': 'U of T',
  'indeed.com': 'Indeed',
  'glassdoor.com': 'Glassdoor',
}
export const siteName = (host: string) => SITE_NAMES[host] ?? SITE_NAMES[host.split('.').slice(-2).join('.')] ?? host

export function decide(signals: Partial<Signals>, prefs: Prefs = {}): Decision {
  const chosen = !!prefs.view
  const none = { recruiter: 0, research: 0, dev: 0 }
  const plain = (mode: Decision['mode']): Decision => ({ mode, scores: none, view: prefs.view ?? 'paper', chosen, late: false })
  if (prefs.personalize === false) return plain('off')
  if (signals.gpc) return plain('gpc')
  if (signals.dnt) return plain('dnt')
  const europe = signals.eu ?? !!signals.timeZone?.startsWith('Europe/')
  const mode = europe && prefs.personalize !== true ? 'ask' : 'on'

  // Until a visitor in Europe says yes, only the link they followed counts.
  const full = mode === 'on'
  const { referrer, via } = signals
  const org = (full && signals.org) || ''
  const university = !!org && UNIVERSITY.test(org)
  const company = !!org && !university && !PROVIDER.test(org)
  const weekday = signals.day !== undefined && signals.day >= 1 && signals.day <= 5
  const office = full && weekday && signals.hour !== undefined && signals.hour >= 9 && signals.hour < 17

  // Each reason: its points, and how it reads in the note.
  const reasons: Record<Persona, Array<[number, string]>> = { recruiter: [], research: [], dev: [] }
  for (const persona of Object.keys(VIA) as Persona[]) {
    if (via && VIA[persona].includes(via)) reasons[persona].push([5, `You followed a link I made for ${persona === 'dev' ? 'developers' : persona === 'research' ? 'labs' : 'recruiters'}`])
  }
  if (referrer && HIRING_SITES.test(referrer)) reasons.recruiter.push([3, `You came from ${siteName(referrer)}`])
  if (referrer && RESEARCH_SITES.test(referrer)) reasons.research.push([3, `You came from ${siteName(referrer)}`])
  if (referrer && DEV_SITES.test(referrer)) reasons.dev.push([3, `You came from ${siteName(referrer)}`])
  if (university) reasons.research.push([3, `You're on ${org}'s network`])
  if (company) reasons.recruiter.push([2, `You're on ${org}'s network`])
  if (office) reasons.recruiter.push([1, "it's the middle of a work day"])
  const setup = full ? setupOf(signals) : undefined
  if (setup) reasons.dev.push(setup)

  const scores = { recruiter: 0, research: 0, dev: 0 }
  for (const persona of Object.keys(scores) as Persona[]) scores[persona] = reasons[persona].reduce((sum, [points]) => sum + points, 0)
  const persona = (['recruiter', 'research', 'dev'] as const).reduce<Persona | undefined>(
    (best, p) => (scores[p] >= 3 && (!best || scores[p] > scores[best]) ? p : best),
    undefined,
  )
  const why = persona ? explain(reasons[persona]) : undefined

  const place = mode === 'on' ? placeOf(signals) : undefined
  const light = mode !== 'on' ? undefined : signals.battery && signals.battery.level < 0.2 && !signals.battery.charging ? 'battery' : signals.saveData ? 'data' : undefined
  return {
    mode,
    persona,
    scores,
    why,
    place,
    view: prefs.view ?? (persona === 'dev' ? 'terminal' : 'paper'),
    chosen,
    light,
    late: mode === 'on' && signals.hour !== undefined && signals.hour < 5,
  }
}

function placeOf(signals: Partial<Signals>): Place | undefined {
  if (signals.country === 'KW' || signals.timeZone === 'Asia/Kuwait') return 'kuwait'
  return undefined
}

/** A developer's setup: Linux (2 points), Firefox (1) and a coding font (2), said as one phrase. */
function setupOf({ os, browser, fonts }: Partial<Signals>): [number, string] | undefined {
  const linux = os === 'Linux'
  const firefox = browser === 'Firefox'
  const font = fonts?.[0]
  const points = (linux ? 2 : 0) + (firefox ? 1 : 0) + (font ? 2 : 0)
  if (!points) return undefined
  if (!linux && !firefox) return [points, `You have ${font} installed`]
  const system = [linux ? 'on Linux' : 'using', firefox ? (linux ? 'with Firefox' : 'Firefox') : ''].filter(Boolean).join(' ')
  const extra = font ? `${linux && firefox ? ' and' : ' with'} ${font} installed` : ''
  return [points, `You're ${system}${extra}`]
}

/** The strongest reasons, as many as it took to reach 3 points: "You're on Acme's network and it's the middle of a work day". */
function explain(reasons: Array<[number, string]>) {
  const used: string[] = []
  let total = 0
  for (const [points, words] of [...reasons].sort((a, b) => b[0] - a[0])) {
    used.push(used.length ? words.replace(/^You/, 'you') : words)
    total += points
    if (total >= 3) break
  }
  return used.join(' and ')
}
