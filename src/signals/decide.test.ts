import { describe, expect, test } from 'bun:test'
import { loadSite } from '../content/load'
import { firstDesk, personalizeSite } from './apply'
import type { Signals } from './collect'
import { decide } from './decide'
import { changes, facts, note } from './words'

const site = await loadSite({ includeDrafts: false })
// A Thursday evening in Toronto, arriving from nowhere in particular.
const base: Partial<Signals> = { gpc: false, dnt: false, languages: ['en-CA'], timeZone: 'America/Vancouver', hour: 19, day: 4, fonts: [] }
const visit = (signals: Partial<Signals>, prefs = {}) => decide({ ...base, ...signals }, prefs)
const deskOrder = (s = site) => s.config.desks.map((d) => d.name)

describe('who is visiting', () => {
  test('Linux with Firefox is a developer, and gets the terminal', () => {
    const d = visit({ os: 'Linux', browser: 'Firefox' })
    expect(d).toMatchObject({ mode: 'on', persona: 'dev', view: 'terminal', why: "You're on Linux with Firefox" })
  })

  test('a coding font counts too, and so does a link from GitHub', () => {
    expect(visit({ os: 'macOS', browser: 'Firefox', fonts: ['JetBrains Mono'] }).why).toBe("You're using Firefox with JetBrains Mono installed")
    expect(visit({ os: 'Windows', browser: 'Chrome', referrer: 'github.com' })).toMatchObject({ persona: 'dev', why: 'You came from GitHub' })
    expect(visit({ os: 'macOS', browser: 'Safari' }).persona).toBeUndefined()
  })

  test('LinkedIn means a recruiter, even on Linux: a tie goes to whoever might be hiring', () => {
    const d = visit({ referrer: 'linkedin.com', os: 'Linux', browser: 'Firefox' })
    expect(d).toMatchObject({ persona: 'recruiter', view: 'paper', why: 'You came from LinkedIn' })
    expect(visit({ via: 'recruiter' }).why).toBe('You followed a link I made for recruiters')
  })

  test("a company's network in office hours is a recruiter; a home internet provider is nobody", () => {
    expect(visit({ org: 'Shopify', day: 2, hour: 14 }).why).toBe("You're on Shopify's network and it's the middle of a work day")
    expect(visit({ org: 'Shopify', day: 6, hour: 14 }).persona).toBeUndefined()
    expect(visit({ org: 'Rogers Communications', day: 2, hour: 14 }).persona).toBeUndefined()
  })

  test('a university network or a scholarly link means research', () => {
    expect(visit({ org: 'University of Toronto' })).toMatchObject({ persona: 'research', why: "You're on University of Toronto's network" })
    expect(visit({ referrer: 'cs.stanford.edu' }).persona).toBe('research')
    expect(visit({ referrer: 'scholar.google.com' }).why).toBe('You came from Google Scholar')
  })

  test("Kuwait's time zone (or Cloudflare saying KW) places them in Kuwait; Toronto needs nothing, the paper already is", () => {
    expect(visit({ timeZone: 'Asia/Kuwait' }).place).toBe('kuwait')
    expect(visit({ timeZone: 'America/Toronto', country: 'KW' }).place).toBe('kuwait')
    expect(visit({ timeZone: 'America/Toronto' }).place).toBeUndefined()
  })

  test('low battery or Save-Data turns the animations off; after midnight, a hello', () => {
    expect(visit({ battery: { level: 0.12, charging: false } }).light).toBe('battery')
    expect(visit({ battery: { level: 0.12, charging: true } }).light).toBeUndefined()
    expect(visit({ saveData: true }).light).toBe('data')
    expect(visit({ hour: 2 }).late).toBe(true)
  })
})

describe('what the visitor asked for', () => {
  test('Global Privacy Control and Do Not Track switch personalizing off, whatever else is true', () => {
    const gpc = visit({ gpc: true, referrer: 'linkedin.com', os: 'Linux', browser: 'Firefox' })
    expect(gpc).toMatchObject({ mode: 'gpc', view: 'paper' })
    expect(gpc.persona).toBeUndefined()
    expect(visit({ dnt: true }).mode).toBe('dnt')
  })

  test('turned off is off; a view they picked is kept', () => {
    const off = visit({ referrer: 'linkedin.com' }, { personalize: false })
    expect(off.mode).toBe('off')
    expect(off.persona).toBeUndefined()
    expect(visit({ os: 'Linux', browser: 'Firefox' }, { view: 'paper' })).toMatchObject({ persona: 'dev', view: 'paper', chosen: true })
  })

  test('in Europe it asks first: only the link they followed counts until they say yes', () => {
    const d = visit({ timeZone: 'Europe/Berlin', referrer: 'linkedin.com', os: 'Linux', browser: 'Firefox', org: 'Siemens' })
    expect(d).toMatchObject({ mode: 'ask', persona: 'recruiter', scores: { recruiter: 3, dev: 0, research: 0 } })
    expect(visit({ timeZone: 'Europe/Berlin', os: 'Linux', browser: 'Firefox' }, { personalize: true })).toMatchObject({ mode: 'on', persona: 'dev' })
    expect(visit({ timeZone: 'America/Toronto', eu: true }).mode).toBe('ask')
  })
})

describe('the front page they get', () => {
  test("nothing to go on: the editor's order, untouched", () => {
    expect(personalizeSite(site, visit({}))).toBe(site)
  })

  test('recruiters get Industry first, sorted by what recruiters look for; the lead stays put', () => {
    const d = visit({ referrer: 'linkedin.com' })
    const mine = personalizeSite(site, d)
    expect(deskOrder(mine)[0]).toBe('Industry')
    expect(mine.config.lead).toBe(site.config.lead)
    expect(mine.config.rail).toEqual(site.config.rail)
    const research = mine.config.desks.find((desk) => desk.name === 'Research')!.items
    expect(research[0]).toBe('mersivity')
    expect(firstDesk(mine, d)).toBe('Industry')
  })

  test('developers get Projects first, researchers Research (already first, so the rest stays put)', () => {
    expect(deskOrder(personalizeSite(site, visit({ os: 'Linux', browser: 'Firefox' })))[0]).toBe('Projects')
    expect(deskOrder(personalizeSite(site, visit({ org: 'University of Toronto' })))).toEqual(deskOrder())
  })

  test('Kuwait moves the Kuwait stories up inside each desk; the briefs stay last', () => {
    const mine = personalizeSite(site, visit({ timeZone: 'Asia/Kuwait' }))
    const campus = mine.config.desks.find((desk) => desk.name === 'Campus')!.items
    expect(campus[0]).toBe('kuwait-years')
    expect(deskOrder(mine).at(-1)).toBe(deskOrder().at(-1))
  })
})

describe('what the page says about it', () => {
  test('the note says what was noticed and what changed, and offers the résumé to recruiters', () => {
    const d = visit({ referrer: 'linkedin.com' })
    expect(note(d, {}, 'Industry')).toEqual({
      hello: undefined,
      text: 'You came from LinkedIn, so Industry is first today and my résumé is one click away.',
      resume: true,
      actions: ['panel', 'off'],
    })
    expect(note(visit({ hour: 2, timeZone: 'Asia/Kuwait' }), {}).hello).toBe('Up late?')
    expect(note(visit({}), {}).text).toContain('Nothing about your visit changed it.')
  })

  test('it thanks Global Privacy Control, asks in Europe, and offers to turn it back on', () => {
    expect(note(visit({ gpc: true }), {}).text).toContain('Thanks for having it on')
    expect(note(visit({ timeZone: 'Europe/Paris' }), {}).actions).toEqual(['yes', 'no', 'panel'])
    expect(note(visit({}, { personalize: false }), {}).actions).toEqual(['on', 'panel'])
  })

  test('never an em-dash, whatever the visitor', () => {
    const visitors = [visit({ referrer: 'linkedin.com', hour: 3, battery: { level: 0.05, charging: false } }), visit({ org: 'University of Toronto', timeZone: 'Asia/Kuwait' }), visit({ os: 'Linux', browser: 'Firefox', saveData: true }), visit({ timeZone: 'Europe/Rome', via: 'lab' }), visit({ dnt: true })]
    for (const d of visitors) {
      expect(note(d, { battery: { level: 0.05, charging: false } }, 'Research').text).not.toContain('\u2014')
      for (const line of changes(d, 'Research', true)) expect(line).not.toContain('\u2014')
    }
  })

  test('the list of everything says "not read" for what it never looked at', () => {
    const groups = facts({ referrer: 'github.com', timeZone: 'America/Toronto', hour: 14, day: 4 })
    const all = Object.fromEntries(groups.flatMap((g) => g.rows))
    expect(all['Came from']).toBe('github.com')
    expect(all['Coding fonts']).toBe('not read')
    expect(all['Local time']).toBe('Thursday, around 2 p.m.')
  })
})

describe('reading the device', () => {
  test('graphics cards are named the way people say them', async () => {
    const { chipName } = await import('./collect')
    expect(chipName('ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)')).toBe('Apple M1')
    expect(chipName('ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('NVIDIA GeForce RTX 3080')
    expect(chipName('Apple M1, or similar')).toBe('Apple M1')
    expect(chipName('Mesa Intel(R) UHD Graphics 620 (KBL GT2)')).toBe('Mesa Intel(R) UHD Graphics 620 (KBL GT2)')
  })

  test('systems and browsers from the user agent', async () => {
    const { osOf, browserOf } = await import('./collect')
    const firefoxLinux = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0'
    const edgeWindows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0'
    const safariMac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
    expect([osOf(firefoxLinux), browserOf(firefoxLinux)]).toEqual(['Linux', ['Firefox', '131']])
    expect([osOf(edgeWindows), browserOf(edgeWindows)]).toEqual(['Windows', ['Edge', '130']])
    expect(browserOf(safariMac)).toEqual(['Safari', '18'])
    expect(osOf('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36')).toBe('Android')
  })
})
