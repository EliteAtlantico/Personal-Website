import { beforeEach, describe, expect, test } from 'bun:test'
import { loadSite } from '../content/load'
import { decide } from '../signals/decide'
import { createShell, parse, plainText, type Env, type Shell, type Visitor } from './commands'
import { lineHtml } from './html'
import type { Line } from './output'
import { ascii } from './rain'

// The shell runs against the real content, so these also catch content changes that break it.
const site = await loadSite({ includeDrafts: false })
const text = (lines: Line[]) => lines.map((l) => l.segments.map((s) => s.text).join('')).join('\n')

let navigated: string[]
let opened: string[]
let reading: Array<{ title: string; lines: Line[] }>
let raining: number
let personalized: boolean[]
let visitor: Visitor | undefined
let shell: Shell
beforeEach(() => {
  navigated = []
  opened = []
  reading = []
  raining = 0
  personalized = []
  visitor = undefined
  const env: Env = {
    navigate: (path) => navigated.push(path),
    read: (title, lines) => reading.push({ title, lines }),
    matrix: () => raining++,
    openUrl: (url) => opened.push(url),
    clear: () => {},
    forget: () => {},
    body: () => [],
    now: () => new Date('2026-09-24T16:04:12-04:00'),
    columns: () => 100,
    site: () => site,
    visitor: () => visitor,
    personalize: (on) => personalized.push(on),
  }
  shell = createShell(site, env)
})

describe('parsing', () => {
  test('splits words, keeps quoted groups, and knows ; from &&', () => {
    expect(parse('grep "real snow"')).toEqual([{ tokens: ['grep', 'real snow'], op: null }])
    expect(parse('cd projects && ls; pwd')).toEqual([
      { tokens: ['cd', 'projects'], op: '&&' },
      { tokens: ['ls'], op: ';' },
      { tokens: ['pwd'], op: null },
    ])
  })

  test('HTML becomes plain text for grep', () => {
    expect(plainText('<p>Tom &amp; Jerry&#39;s <strong>EEG</strong></p>')).toBe("Tom & Jerry's EEG")
  })
})

describe('files and folders', () => {
  test('ls lists section folders and the files at home', () => {
    const [grid] = shell.run('ls')
    const names = grid!.segments.map((s) => s.text)
    expect(grid!.grid).toBe(true)
    expect(names).toContain('projects/')
    expect(names).toContain('about.md')
    expect(names).toContain('resume.pdf')
  })

  test('cd moves the prompt, .. and ~ come back, mistakes are errors', () => {
    shell.run('cd projects')
    expect(shell.prompt()).toBe('guest@chaghouri:~/projects$')
    shell.run('cd ..')
    expect(shell.cwd()).toBe('~')
    expect(text(shell.run('cd nowhere'))).toContain('no such folder')
    shell.run('cd ~/hobbies')
    expect(text(shell.run('ls'))).toContain('guitar.md')
  })

  test('&& stops after a failure', () => {
    expect(text(shell.run('cd nowhere && ls'))).not.toContain('about.md')
  })
})

describe('reading and opening', () => {
  test('cat prints a story by name from anywhere, headline first', () => {
    shell.run('cd hobbies')
    const out = shell.run('cat butler-bot')
    expect(out[0]!.segments[0]!.text).toBe('A Robot That Does Your Chores (in Simulation, For Now)')
    expect(text(out)).toContain('Arham Aamir')
  })

  test('open shows a story in the reader, never the paper; links open in a new tab', () => {
    shell.run('open butler-bot')
    expect(navigated).toEqual([])
    expect(reading[0]!.title).toBe('~/projects/butler-bot.md')
    expect(text(reading[0]!.lines)).toContain('related')
    shell.run('open github')
    expect(opened).toEqual(['https://github.com/EliteAtlantico'])
    shell.run('resume')
    expect(opened.at(-1)).toBe('/resume.pdf')
  })

  test('the dashboard lays out the paper: lead, now, about, and a pane per desk', () => {
    const [board] = shell.run('dashboard')
    const panes = board!.panes!
    expect(panes.map((p) => p.title)).toEqual(expect.arrayContaining(['now', 'about', 'research', 'industry', 'projects', 'campus', 'off hours']))
    expect(panes[0]!.area).toBe('lead')
    const projects = panes.find((p) => p.title === 'projects')!
    expect(projects.rows).toContainEqual(expect.objectContaining({ label: 'Butler[bot]', run: 'open ~/projects/butler-bot.md' }))
  })

  test('the lead story rains under itself, and cmatrix rains full screen', () => {
    const [board] = shell.run('dashboard')
    const lead = board!.panes!.find((p) => p.area === 'lead')!
    expect(lead.rain).toBe(site.config.lead)
    expect(lineHtml(board!)).toContain(`<div class="t-rain" data-story="${site.config.lead}" aria-hidden="true">`)
    expect(shell.run('cmatrix')).toEqual([])
    shell.run('matrix')
    expect(raining).toBe(2)
  })

  test('the rain is plain ASCII', () => {
    expect(ascii('Café “snow” – β/α × 3…  ok')).toBe('Cafe "snow" - / x 3... ok')
  })

  test('neofetch knows its Arch (btw)', () => {
    expect(text(shell.run('neofetch'))).toContain('Arch Linux (btw) + Hyprland')
  })

  test('exit logs straight back in, to the dashboard', () => {
    shell.run('cd projects')
    const out = shell.run('exit')
    expect(text(out)).toContain('Connection to chaghouri closed.')
    expect(out.some((l) => l.panes)).toBe(true)
    expect(shell.cwd()).toBe('~')
    expect(navigated).toEqual([])
  })

  test('grep finds a word in any story, case-insensitively, and marks it', () => {
    const hits = shell.run('grep eeg')
    expect(hits.length).toBeGreaterThan(1)
    const match = hits[0]!.segments.find((s) => s.style === 'match')
    expect(match?.text.toLowerCase()).toBe('eeg')
  })

  test('clickable output renders as buttons and links, escaped', () => {
    const html = lineHtml({ segments: [{ text: '<b>', run: 'cat "x"' }, { text: 'site', href: 'https://example.com' }, { text: 'bad', href: 'javascript:alert(1)' }] })
    expect(html).toContain('data-run="cat &quot;x&quot;"')
    expect(html).toContain('&lt;b&gt;')
    expect(html).toContain('target="_blank"')
    expect(html).not.toContain('javascript:')
  })
})

describe('who you are, to the site', () => {
  const signals = { referrer: 'github.com', gpc: false, dnt: false, languages: ['en-CA'], timeZone: 'America/Toronto', hour: 14, day: 4, os: 'Linux', browser: 'Firefox', fonts: ['JetBrains Mono'] }

  test('a developer sent to the terminal is told why at login', () => {
    visitor = { signals, decision: decide(signals), first: 'Projects', terminal: true }
    const login = text(shell.welcome())
    // The strongest reason comes first: the setup (5 points) outweighs the link from GitHub (3).
    expect(login).toContain("You're on Linux with Firefox and JetBrains Mono installed, so the site opened as a terminal.")
    visitor = { ...visitor, terminal: false }
    expect(text(shell.welcome())).not.toContain('opened as a terminal')
  })

  test('whoami lists everything the browser told it, and what it did with it', () => {
    visitor = { signals, decision: decide(signals), first: 'Projects', terminal: true }
    const out = text(shell.run('whoami'))
    expect(out).toContain('Came from')
    expect(out).toContain('JetBrains Mono')
    expect(out).toContain('Opened the site as a terminal')
    expect(out).toContain('Put Projects first')
  })

  test('with Global Privacy Control on, it says nothing changed and personalize stays off', () => {
    const gpc = { ...signals, gpc: true }
    visitor = { signals: gpc, decision: decide(gpc), terminal: false }
    expect(text(shell.run('whoami'))).toContain('none of it changed anything')
    expect(text(shell.run('personalize on'))).toContain('stays off')
    expect(personalized).toEqual([])
  })

  test('personalize switches it, and Tab knows on and off', () => {
    visitor = { signals, decision: decide(signals), terminal: false }
    shell.run('personalize off')
    shell.run('personalize on')
    expect(personalized).toEqual([false, true])
    expect(shell.complete('personalize o').options).toEqual(['on', 'off'])
  })
})

describe('typing', () => {
  test('Tab completes commands and paths', () => {
    expect(shell.complete('neof').value).toBe('neofetch ')
    expect(shell.complete('cd pro').value).toBe('cd projects/')
    expect(shell.complete('cat projects/butl').value).toBe('cat projects/butler-bot.md ')
    const { value, options } = shell.complete('c')
    expect(value).toBe('c')
    expect(options).toEqual(expect.arrayContaining(['cat', 'cd', 'clear', 'contact']))
  })

  test('typos get a suggestion, and !! repeats the last command', () => {
    expect(text(shell.run('lss'))).toContain('Did you mean ls?')
    shell.run('cd projects')
    shell.run('cd ..')
    shell.run('!!')
    expect(shell.cwd()).toBe('~')
    expect(shell.history()).toEqual(['lss', 'cd projects', 'cd ..'])
  })

  test('the easter eggs stay out of help', () => {
    const help = text(shell.run('help'))
    expect(help).toContain('grep')
    expect(help).not.toContain('sudo')
    expect(text(shell.run('sudo rm -rf /'))).toContain('sudoers')
  })
})
