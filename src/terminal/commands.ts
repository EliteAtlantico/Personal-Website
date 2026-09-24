// The shell behind the terminal view. It parses what was typed, runs commands
// over the site's filesystem (fs.ts) and returns what to print (output.ts).
// The terminal is its own way of reading the site: stories open in its reader,
// never on the paper's pages. Anything that touches the page (the reader,
// opening a tab, clearing the screen) goes through Env, so the whole shell
// also runs in tests.
import { relatedItems } from '../content/related'
import type { Item, Site } from '../content/types'
import { since, type Reading } from '../desk'
import { formatShortDate } from '../render/html'
import type { Signals } from '../signals/collect'
import type { Decision } from '../signals/decide'
import { changes, facts } from '../signals/words'
import { dashboard, storyPath } from './dashboard'
import { buildFs, completePath, display, files, find, HOST, resolve, USER, type Dir, type File, type Node } from './fs'
import { blank, error, field, line, seg, type Line, type Segment } from './output'

export interface Env {
  /** Switch to another view of the site (only ever asked for by name: view paper). */
  navigate(path: string): void
  /** Show a story in the terminal's reader, full screen, until it's closed. */
  read(title: string, lines: Line[]): void
  /** Full-screen digital rain made of the site's words (rain.ts), until it's closed. */
  matrix(): void
  /** The globe of where the stories happened (src/globe), full screen, until it's closed. */
  globe(): void
  /** Open a link in a new tab. */
  openUrl(url: string): void
  clear(): void
  /** Wipe the session: history and scrollback. */
  forget(): void
  /** An item's article body, as terminal lines. */
  body(item: Item): Line[]
  now(): Date
  /** How many characters fit on a line. */
  columns(): number
  /** The site as this visitor's front page lays it out (src/signals); the dashboard follows it. */
  site(): Site
  /** What the visitor's browser shared, and what personalizing did with it (whoami). */
  visitor(): Visitor | undefined
  /** Turns personalizing on or off, remembered in their browser. */
  personalize(on: boolean): void
  /** The desk serving the site, if it's been heard from (src/desk.ts). */
  desk(): Reading | null
}

/** What the site knows about the visitor, all of it read in their browser (src/signals). */
export interface Visitor {
  signals: Partial<Signals>
  decision: Decision
  /** The desk their kind of visitor moved to the top ("Projects"). */
  first?: string
  /** The terminal opened because of them (not because they asked for it). */
  terminal: boolean
}

export interface Shell {
  /** "guest@chaghouri:~/projects$" */
  prompt(): string
  /** "~/projects" */
  cwd(): string
  /** The prompt followed by a command, as the terminal shows what was typed. */
  echo(command: string, after?: Segment[]): Line
  /** The screen at login: a greeting, then the dashboard. */
  welcome(): Line[]
  /** Runs what was typed. `record: false` keeps it out of the history. */
  run(input: string, options?: { record?: boolean }): Line[]
  /** Tab: the input completed as far as it can go, and the choices if there are several. */
  complete(input: string): { value: string; options: string[] }
  history(): readonly string[]
  clearHistory(): void
}

interface Command {
  name: string
  /** Its arguments, as shown in help ("<file>", "[folder]"). */
  usage?: string
  summary: string
  details?: string[]
  /** Other names for it. */
  aliases?: string[]
  /** Easter eggs: not in help, not tab-completed. */
  hidden?: boolean
  /** What its arguments complete to. */
  completes?: 'path' | 'dir' | 'command' | 'view' | 'toggle'
  run(args: string[]): Line[]
}

export function createShell(site: Site, env: Env): Shell {
  const root = buildFs(site)
  let cwd: string[] = []
  let previous: string[] = []
  let history: string[] = []

  // --- Pieces of output that commands share ---

  /** A file or folder name that does something when clicked: folders list, stories open in the reader. */
  const nameSeg = (node: Node, path: string[]): Segment =>
    node.kind === 'dir'
      ? { text: `${node.name}/`, style: 'dir', run: `cd ${display(path)} && ls` }
      : { text: node.name, style: 'file', run: `open ${display(path)}` }
  const runSeg = (command: string, text = command): Segment => ({ text, style: 'accent', run: command })
  const fillSeg = (command: string, text = command.trim()): Segment => ({ text, style: 'accent', fill: command })
  const pretty = (url: string) => url.replace(/^mailto:/, '').replace(/^https?:\/\/(www\.)?/, '').replace(/^\//, '')
  const isExternal = (url: string) => /^(https?:|mailto:)/.test(url)

  const contact = (): Line[] =>
    site.config.links.map((link) => field(link.label, [{ text: pretty(link.url) + (isExternal(link.url) ? ' ↗' : ''), href: link.url }]))

  const describe = (file: File) =>
    file.type === 'bio' ? 'about me' : file.type === 'contact' ? 'email and links' : file.type === 'pdf' ? 'résumé' : file.item.section === 'now' ? "what I'm doing now" : ''

  // --- Commands ---

  /** A story, everything the paper's page has: headline, facts, write-up, outcomes, links, media, related stories. */
  const story = (item: Item): Line[] => {
    const out: Line[] = [line(seg(item.headline ?? item.title, 'heading'))]
    const meta = [
      item.headline && item.headline !== item.title ? item.title : '',
      item.org ?? '',
      item.dates ?? '',
      item.status ? item.status.replaceAll('-', ' ') : '',
      item.updated ? `updated ${formatShortDate(item.updated)}` : '',
    ].filter(Boolean)
    if (meta.length) out.push(line(seg(meta.join(' · '), 'dim')))
    const facts = [
      item.role && field('role', item.role, 7),
      item.team.length > 0 && field('team', item.team.join(', '), 7),
      item.stack.length > 0 && field('stack', item.stack.join(', '), 7),
    ].filter((fact): fact is Line => !!fact)
    if (facts.length) out.push(blank(), ...facts)
    // An excerpt's blurb is the opening of the body, which follows anyway.
    if (!item.excerpt) out.push(blank(), line(item.blurb))
    const body = env.body(item)
    if (body.length) out.push(blank(), ...body)
    if (item.outcomes.length) out.push(blank(), line(seg('outcomes', 'dim')), ...item.outcomes.map((o) => ({ ...line(seg('- ', 'dim'), o), hang: 2 })))
    if (item.links.length) {
      out.push(blank(), field('links', item.links.flatMap((link, i): Segment[] => [...(i ? [seg('   ')] : []), { text: `${link.label}${isExternal(link.url) ? ' ↗' : ''}`, href: link.url }]), 7))
    }
    const media = item.media.map(
      (m): Segment => (m.type === 'youtube' ? { text: `▶ ${m.title ?? 'video'} ↗`, href: `https://www.youtube.com/watch?v=${m.id}` } : { text: `${m.caption ?? m.alt} ↗`, href: m.src }),
    )
    if (media.length) out.push(field('media', media.flatMap((m, i) => [...(i ? [seg('   ')] : []), m]), 7))
    const related = relatedItems(site, item)
    if (related.length) {
      out.push(blank(), line(seg('related', 'dim')), ...related.map((other) => ({ ...line(seg('- ', 'dim'), runSeg(`open ${storyPath(other)}`, other.title), seg(`  ${other.headline && other.headline !== other.title ? other.headline : ''}`, 'dim')), hang: 2 })))
    }
    return out
  }

  const catFile = (file: File): Line[] => {
    switch (file.type) {
      case 'item':
        return story(file.item)
      case 'bio':
        return (site.bio?.text ?? '').split(/\n\s*\n/).flatMap((p, i) => [...(i ? [blank()] : []), line(p.replace(/\s+/g, ' ').trim())])
      case 'contact':
        return contact()
      case 'pdf':
        return [line(seg(`${file.name} is a PDF: `, 'dim'), runSeg(`open ${file.name}`))]
    }
  }

  /** A path typed at the prompt, or failing that any file with that name or slug. */
  const locate = (arg: string): { node: Node; path: string[] } | null => {
    const here = resolve(root, cwd, arg)
    if (here) return here
    const anywhere = find(root, arg)
    return anywhere ? { node: anywhere.file, path: anywhere.path } : null
  }

  const listing = (dir: Dir, path: string[]): Line[] => {
    if (!dir.children.length) return []
    return [{ segments: dir.children.map((child) => nameSeg(child, [...path, child.name])), grid: true }]
  }

  const longListing = (dir: Dir, path: string[]): Line[] => {
    const dateWidth = Math.max(8, ...dir.children.map((child) => (child.kind === 'file' && child.type === 'item' ? (child.item.dates ?? '').length : 0))) + 2
    const nameWidth = Math.max(...dir.children.map((child) => child.name.length + 1)) + 2
    return dir.children.map((child) => {
      const name = nameSeg(child, [...path, child.name])
      const pad = seg(' '.repeat(Math.max(1, nameWidth - name.text.length)))
      if (child.kind === 'dir') {
        const n = child.children.length
        return line(seg('folder'.padEnd(dateWidth), 'dim'), name, pad, seg(`${n} ${n === 1 ? 'story' : 'stories'}`, 'dim'))
      }
      if (child.type === 'item' && child.item.section !== 'now') {
        return { ...line(seg((child.item.dates ?? '').padEnd(dateWidth), 'dim'), name, pad, child.item.headline ?? child.item.title), hang: dateWidth + nameWidth }
      }
      return line(seg(''.padEnd(dateWidth)), name, pad, seg(describe(child), 'dim'))
    })
  }

  const tree = (dir: Dir, path: string[], prefix = ''): Line[] =>
    dir.children.flatMap((child, i) => {
      const last = i === dir.children.length - 1
      const here = [...path, child.name]
      const row = line(seg(prefix + (last ? '└── ' : '├── '), 'dim'), nameSeg(child, here))
      return child.kind === 'dir' ? [row, ...tree(child, here, prefix + (last ? '    ' : '│   '))] : [row]
    })

  const neofetch = (): Line[] => {
    const reading = env.desk()
    const live = reading?.desk.live ? (reading as Reading & { desk: { live: true; uptime: number } }) : null
    const bySlug = (slug: string) => site.items.find((item) => item.slug === slug)
    const study = bySlug('uoft')
    const lab = bySlug('mersivity')
    const rig = bySlug('hobby-tech-head')
    const work = site.items.filter((item) => item.section === 'work').map((item) => item.title.split(' ')[0])
    const stories = site.items.filter((item) => item.section !== 'now').length
    const info = [
      line(seg(USER, 'accent'), seg('@', 'dim'), seg(HOST, 'accent')),
      line(seg('-'.repeat(USER.length + HOST.length + 1), 'dim')),
      field('Name', site.config.author),
      study && field('Study', `${study.title}, ${study.org}`),
      study?.role && field('Program', `${study.role}${study.dates ? ` (${study.dates})` : ''}`),
      field('Based', site.config.edition),
      lab?.role && field('Research', lab.role),
      work.length > 0 && field('Work', work.join(' · ')),
      rig && rig.stack.length > 1 && field('Setup', rig.stack.slice(0, 2).join(' + ').replace('Arch Linux', 'Arch Linux (btw)')),
      live && field('Uptime', `${since(live.desk.uptime + (env.now().getTime() - live.at) / 1000)} (it's serving you this)`),
      field('Stack', topStack(site.items, 6).join(', ')),
      field('Stories', [`${stories}  `, runSeg('ls', 'ls to browse')]),
      blank(),
      line(seg('███', 'accent'), seg('███', 'green'), seg('███', 'strong'), seg('███', 'dim')),
    ].filter((row): row is Line => !!row)
    if (env.columns() < 64) return info
    // Side by side with the logo, when there's room.
    const width = Math.max(...LOGO.map((row) => row.length)) + 3
    return info.map((row, i) => ({
      segments: [seg((LOGO[i] ?? '').padEnd(width), 'accent'), ...row.segments],
      hang: width + (row.hang ?? 0),
    }))
  }

  const commands: Command[] = [
    {
      name: 'dashboard',
      summary: 'everything at a glance, like the front page',
      aliases: ['home', 'front'],
      run: () => [...dashboard(env.site(), { live: true }), tip()],
    },
    {
      name: 'help',
      usage: '[command]',
      summary: 'this list',
      aliases: ['?'],
      completes: 'command',
      run: ([name]) => (name ? man(name) : help()),
    },
    {
      name: 'ls',
      usage: '[folder]',
      summary: 'list stories and folders',
      details: ['ls -l also shows dates and headlines.'],
      aliases: ['dir', 'll'],
      completes: 'path',
      run: (args) => {
        const long = args.some((arg) => /^-[a-z]*l/.test(arg))
        const targets = args.filter((arg) => !arg.startsWith('-'))
        return (targets.length ? targets : ['.']).flatMap((target, i) => {
          const found = resolve(root, cwd, target)
          if (!found) return [error(`ls: cannot access '${target}': no such file or folder`)]
          const heading = targets.length > 1 && found.node.kind === 'dir' ? [...(i ? [blank()] : []), line(seg(`${display(found.path)}:`, 'dim'))] : []
          if (found.node.kind === 'file') return [line(nameSeg(found.node, found.path))]
          return [...heading, ...(long ? longListing(found.node, found.path) : listing(found.node, found.path))]
        })
      },
    },
    {
      name: 'cd',
      usage: '[folder]',
      summary: 'change folder (cd .. goes up, cd goes home)',
      completes: 'dir',
      run: ([target]) => {
        if (target === '-') [cwd, previous] = [previous, cwd]
        else if (!target || target === '~') [cwd, previous] = [[], cwd]
        else {
          const found = resolve(root, cwd, target)
          if (!found) return [error(`cd: no such folder: ${target}`)]
          if (found.node.kind !== 'dir') return [line(seg(`cd: ${target} is a file. `, 'error'), runSeg(`open ${display(found.path)}`, `open ${target}`))]
          ;[cwd, previous] = [found.path, cwd]
        }
        return []
      },
    },
    {
      name: 'cat',
      usage: '<file>',
      summary: 'read a story right here, as text',
      completes: 'path',
      run: (args) => {
        if (!args.length) return [line(seg('cat: which file? Try ', 'error'), runSeg('cat ~/about.md', 'cat about.md'))]
        return args.flatMap((arg, i) => {
          const found = locate(arg)
          if (!found) return [error(`cat: ${arg}: no such file`)]
          if (found.node.kind === 'dir') return [line(seg(`cat: ${arg} is a folder. `, 'error'), runSeg(`ls ${display(found.path)}`, `ls ${arg}`))]
          return [...(i ? [blank()] : []), ...catFile(found.node)]
        })
      },
    },
    {
      name: 'open',
      usage: '<file>',
      summary: 'read a story in the reader (q closes it), or open a link: open github',
      details: ['Links you can open: ' + site.config.links.map((link) => normalize(link.label)).join(', ') + '.'],
      aliases: ['less', 'more'],
      completes: 'path',
      run: ([target]) => {
        if (!target) return [line(seg('open what? e.g. ', 'error'), runSeg('open butler-bot'), seg(' or ', 'dim'), runSeg('open github'))]
        const link = site.config.links.find((l) => normalize(l.label) === normalize(target))
        if (link) {
          env.openUrl(link.url)
          return [line(seg('opening ', 'dim'), { text: pretty(link.url), href: link.url })]
        }
        const found = locate(target)
        if (!found) return [error(`open: ${target}: no such file`)]
        const { node } = found
        if (node.kind === 'dir') return [line(seg(`open: ${target} is a folder. `, 'error'), runSeg(`ls ${display(found.path)}`, `ls ${target}`))]
        if (node.type === 'pdf') {
          env.openUrl(node.href)
          return [line(seg('opening ', 'dim'), { text: node.name, href: node.href })]
        }
        if (node.type === 'contact') return catFile(node)
        // Stories (and about.md) open in the reader; closing it comes back here.
        env.read(display(found.path), catFile(node))
        return []
      },
    },
    {
      name: 'tree',
      usage: '[folder]',
      summary: 'everything at once',
      completes: 'dir',
      run: ([target = '.']) => {
        const found = resolve(root, cwd, target)
        if (!found || found.node.kind !== 'dir') return [error(`tree: no such folder: ${target}`)]
        return [line(seg(display(found.path), 'dir')), ...tree(found.node, found.path)]
      },
    },
    {
      name: 'grep',
      usage: '<words>',
      summary: 'search every story',
      details: ['Case doesn\'t matter: grep eeg finds "EEG".'],
      run: (args) => {
        const pattern = args.filter((arg) => !arg.startsWith('-')).join(' ')
        if (!pattern) return [line(seg('grep: search for what? e.g. ', 'error'), runSeg('grep python'))]
        const needle = pattern.toLowerCase()
        const hits = files(root).flatMap(({ file, path }) => {
          const fields = file.type === 'item' ? searchable(file.item) : file.type === 'bio' ? [{ text: (site.bio?.text ?? '').replace(/\s+/g, ' ') }] : []
          // The first field that mentions it: the story's own words before its stack and tags.
          for (const { label, text } of fields) {
            const at = text.toLowerCase().indexOf(needle)
            if (at >= 0) return [{ path, label, text, at }]
          }
          return []
        })
        if (!hits.length) return [line(seg(`no matches for "${pattern}"`, 'dim'))]
        return hits.map(({ path, label, text, at }) => {
          const from = Math.max(0, text.lastIndexOf(' ', Math.max(0, at - 36)))
          const to = Math.min(text.length, at + needle.length + 44)
          return {
            ...line(
              { text: `${path.join('/')}:`, style: 'file', run: `open ${display(path)}` },
              label ? seg(` ${label}:`, 'dim') : '',
              ` ${from > 0 ? '…' : ''}${text.slice(from, at).trimStart()}`,
              seg(text.slice(at, at + needle.length), 'match'),
              `${text.slice(at + needle.length, to)}${to < text.length ? '…' : ''}`,
            ),
            hang: 2,
          }
        })
      },
    },
    { name: 'neofetch', summary: 'me, at a glance', aliases: ['fastfetch'], run: neofetch },
    {
      name: 'globe',
      summary: 'where the stories happened, on a globe (q closes it)',
      details: ['Drag to turn it and scroll to zoom. Pick a dot, or Tab to a story and press Enter, to read it.'],
      aliases: ['map', 'earth', 'world'],
      run: () => {
        env.globe()
        return []
      },
    },
    {
      name: 'cmatrix',
      summary: 'digital rain made of these stories (q stops it)',
      details: ["Move your mouse through it. It's set with pretext, one line of a story per drop."],
      aliases: ['matrix'],
      run: () => {
        env.matrix()
        return []
      },
    },
    { name: 'contact', summary: 'how to reach me', aliases: ['hire'], run: contact },
    {
      name: 'resume',
      summary: 'my résumé (PDF)',
      aliases: ['résumé', 'cv'],
      run: () => {
        const pdf = site.config.links.find((link) => link.url.endsWith('.pdf'))
        if (!pdf) return [error('resume: not found')]
        env.openUrl(pdf.url)
        return [line(seg('opening ', 'dim'), { text: pretty(pdf.url), href: pdf.url })]
      },
    },
    { name: 'whoami', summary: 'who you are, to this site: everything your browser told it', run: () => whoami() },
    {
      name: 'personalize',
      usage: '[on|off]',
      summary: 'whether the site rearranges itself for you',
      completes: 'toggle',
      run: ([choice]) => {
        const mode = env.visitor()?.decision.mode
        if ((mode === 'gpc' || mode === 'dnt') && choice !== 'off') {
          return [line(seg("Your browser asks sites not to track you, so personalizing stays off. Thanks for having that on.", 'dim'))]
        }
        switch (normalize(choice ?? '')) {
          case '':
            return [line(`Personalizing is ${mode === 'on' ? 'on' : mode === 'ask' ? 'waiting for a yes' : 'off'}. `, seg('Try ', 'dim'), runSeg(mode === 'on' ? 'personalize off' : 'personalize on'), seg(', or ', 'dim'), runSeg('whoami'), seg(' to see what it uses.', 'dim'))]
          case 'on':
          case 'yes':
            env.personalize(true)
            return [line(seg('Personalizing is on. ', 'dim'), runSeg('dashboard'), seg(' shows the result, and ', 'dim'), runSeg('whoami'), seg(' shows what it used.', 'dim'))]
          case 'off':
          case 'no':
            env.personalize(false)
            return [line(seg('Personalizing is off: the paper and ', 'dim'), runSeg('dashboard'), seg(' are in the order everyone gets.', 'dim'))]
          default:
            return [line(seg('personalize: on or off? e.g. ', 'error'), runSeg('personalize off'))]
        }
      },
    },
    {
      name: 'uptime',
      summary: 'how long the desk serving this has been up',
      run: () => {
        const now = env.now()
        const reading = env.desk()
        if (reading?.desk.live) {
          const { desk } = reading
          const seconds = desk.uptime + (now.getTime() - reading.at) / 1000
          const cpu = desk.cpu === null ? '' : `, CPU at ${desk.cpu}°C`
          return [
            line(` ${clock(now)} up ${upFor(seconds)},  1 user,  load average: ${desk.load.map((n) => n.toFixed(2)).join(', ')}`),
            line(seg(`Served live from ${desk.name} (${desk.system} ${desk.kernel}, ${desk.cores} cores${cpu}).`, 'dim')),
          ]
        }
        if (reading) return [line(seg(`My desk is asleep, so this is the copy Cloudflare keeps. It was built ${shortDate(site.builtAt)}.`, 'dim'))]
        const built = new Date(site.builtAt)
        const minutes = Math.max(1, Math.round((now.getTime() - built.getTime()) / 60000))
        const up = minutes >= 1440 ? `${Math.floor(minutes / 1440)} day${minutes >= 2880 ? 's' : ''}` : minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}` : `${minutes} min`
        return [line(` ${clock(now)} up ${up},  1 user,  load average: 0.00, 0.00, 0.00`), line(seg(`This copy of the site was built ${shortDate(site.builtAt)}.`, 'dim'))]
      },
    },
    {
      name: 'history',
      summary: "what you've typed (click to run again)",
      run: () => history.map((entry, i) => line(seg(`${String(i + 1).padStart(4)}  `, 'dim'), { text: entry, run: entry })),
    },
    {
      name: 'clear',
      summary: 'clear the screen (Ctrl+L)',
      aliases: ['cls'],
      run: () => {
        env.clear()
        return []
      },
    },
    {
      name: 'view',
      usage: '<name>',
      summary: 'switch views: view paper',
      completes: 'view',
      run: ([name]) => {
        switch (normalize(name ?? '')) {
          case '':
            return [line('views: ', runSeg('view paper', 'paper'), seg('  terminal (here). The globe is a command: ', 'dim'), runSeg('globe'))]
          case 'paper':
          case 'newspaper':
          case 'front':
            env.navigate('/')
            return [line(seg('switching to the paper', 'dim'))]
          case 'terminal':
            return [line(seg("You're already in the terminal.", 'dim'))]
          case 'globe':
          case 'map':
            env.globe()
            return []
          default:
            return [line(seg(`view: no view called ${name}. Try `, 'error'), runSeg('view paper'))]
        }
      },
    },
    {
      name: 'forget',
      summary: 'wipe this session',
      run: () => {
        env.forget()
        return [line(seg('Session wiped: your history, this screen and any choices you made here are gone. The site keeps nothing else about you.', 'dim'))]
      },
    },
    {
      name: 'exit',
      summary: 'log out (and straight back in)',
      aliases: ['logout', 'quit'],
      run: () => {
        env.clear()
        return [line(seg('logout', 'dim')), line(seg(`Connection to ${HOST} closed.`, 'dim')), blank(), ...welcome()]
      },
    },
    { name: 'man', usage: '<command>', summary: 'more about a command', hidden: true, completes: 'command', run: ([name]) => (name ? man(name) : [line(seg('man: which command? e.g. ', 'error'), runSeg('man ls'))]) },
    { name: 'pwd', summary: 'where you are', hidden: true, run: () => [line(`/home/${USER}${cwd.map((name) => `/${name}`).join('')}`)] },
    { name: 'echo', summary: 'say something', hidden: true, run: (args) => [line(args.join(' '))] },
    { name: 'date', summary: 'the date', hidden: true, run: () => [line(unixDate(env.now()))] },
    { name: 'sudo', summary: '', hidden: true, run: () => [error(`${USER} is not in the sudoers file. This incident will be reported.`)] },
    { name: 'rm', summary: '', hidden: true, run: (args) => [error(`rm: cannot remove '${args.filter((a) => !a.startsWith('-')).at(-1) ?? ''}': Read-only file system`)] },
    { name: 'vim', summary: '', hidden: true, aliases: ['vi', 'nvim'], run: () => [line(seg("You'd never get out. Try ", 'dim'), fillSeg('cat '), seg(' instead.', 'dim'))] },
    { name: 'nano', summary: '', hidden: true, aliases: ['emacs', 'code'], run: () => [line(seg('This terminal only reads. Try ', 'dim'), fillSeg('cat '), seg(' instead.', 'dim'))] },
    {
      name: 'pacman',
      summary: '',
      hidden: true,
      aliases: ['yay', 'paru'],
      run: () => [error('error: you cannot perform this operation unless you are root.'), line(seg('(My desktop really does run Arch, btw.)', 'dim'))],
    },
    { name: 'apt', summary: '', hidden: true, aliases: ['apt-get', 'brew'], run: () => [line(seg('This is an Arch household. Try ', 'dim'), fillSeg('pacman '), seg('.', 'dim'))] },
  ]

  const lookup = (name: string) => commands.find((c) => c.name === name || c.aliases?.includes(name))
  const visible = commands.filter((c) => !c.hidden)

  function help(): Line[] {
    const label = (c: Command) => (c.usage ? `${c.name} ${c.usage}` : c.name)
    const width = Math.max(...visible.map((c) => label(c).length)) + 3
    return [
      line(seg('Click a command or type it. Tab completes; Up and Down go through history.', 'dim')),
      blank(),
      ...visible.map((c) => ({
        ...line(
          c.usage?.startsWith('<') ? fillSeg(`${c.name} `, c.name) : runSeg(c.name),
          c.usage ? seg(` ${c.usage}`, 'dim') : '',
          ' '.repeat(width - label(c).length),
          c.summary,
        ),
        hang: width,
      })),
      blank(),
      line(seg('man <command> says more about one.', 'dim')),
    ]
  }

  function man(name: string): Line[] {
    const c = lookup(name)
    if (!c || c.hidden) return [error(`No manual entry for ${name}`)]
    return [
      line(seg(`${c.name}${c.usage ? ` ${c.usage}` : ''}`, 'strong')),
      { ...line(`    ${c.summary}`), hang: 4 },
      ...(c.details ?? []).map((d) => ({ ...line(`    ${d}`), hang: 4 })),
      ...(c.aliases?.length ? [line(seg(`    also: ${c.aliases.join(', ')}`, 'dim'))] : []),
    ]
  }

  /** The prompt followed by a command, as the terminal shows what was typed. */
  function echo(command: string, after: Segment[] = []): Line {
    return line(seg(`${USER}@${HOST}`, 'accent'), seg(':', 'dim'), seg(display(cwd), 'green'), seg('$', 'dim'), ` ${command}`, ...after)
  }

  /** Under the dashboard: how to get around, grep first. */
  function tip(): Line {
    return line(
      seg('Click any story to read it. ', 'dim'),
      fillSeg('grep ', 'grep'),
      seg(' searches everything (try ', 'dim'),
      runSeg('grep python'),
      seg('), and ', 'dim'),
      runSeg('help'),
      seg(' lists the rest.', 'dim'),
    )
  }

  /** The dashboard, from ~, as if it had just been typed. */
  function home(): Line[] {
    cwd = []
    return [echo('dashboard'), ...dashboard(env.site(), { live: true }), tip()]
  }

  /** The screen at login, saying why it's a terminal if the site chose that for them. */
  function welcome(): Line[] {
    const visitor = env.visitor()
    const why = visitor?.terminal && visitor.decision.why
    return [
      line(seg(`Last login: ${lastLogin(env.now())} on ttys001`, 'dim')),
      ...(why
        ? [line(seg(`${why}, so the site opened as a terminal. `, 'dim'), runSeg('view paper'), seg(' switches to the newspaper, and ', 'dim'), runSeg('whoami'), seg(' shows everything your browser told me.', 'dim'))]
        : []),
      ...home(),
    ]
  }

  /** Everything the visitor's browser told the site, and what the site did with it. */
  function whoami(): Line[] {
    const visitor = env.visitor()
    const intro = [line(USER), line(seg('No accounts and no cookies here, so everyone is a guest. But every browser tells every site a few things:', 'dim'))]
    if (!visitor) return intro
    const groups = facts(visitor.signals)
    const width = Math.max(...groups.flatMap((g) => g.rows.map(([label]) => label.length))) + 3
    const { mode } = visitor.decision
    const done = mode === 'on' || mode === 'ask' ? changes(visitor.decision, visitor.first, visitor.terminal) : []
    const status =
      mode === 'gpc' || mode === 'dnt'
        ? [line(seg('Your browser asks sites not to track you, so none of it changed anything, and your device was never read. Thanks for having that on.', 'dim'))]
        : mode === 'off'
          ? [line(seg('Personalizing is off, so none of it changed anything. ', 'dim'), runSeg('personalize on'), seg(' turns it back on.', 'dim'))]
          : [
              line(seg('what I did with it', 'heading')),
              ...(done.length ? done.map((d) => ({ ...line(seg('- ', 'dim'), d), hang: 2 })) : [line('Nothing: you get the page everyone gets.')]),
              blank(),
              line(seg('None of it is kept or sent anywhere. ', 'dim'), runSeg('personalize off'), seg(' switches it off; ', 'dim'), runSeg('forget'), seg(' wipes your choices too.', 'dim')),
            ]
    return [
      ...intro,
      ...groups.flatMap(({ group, rows }) => [blank(), line(seg(group.toLowerCase(), 'heading')), ...rows.map(([label, value]) => field(`  ${label}`, value, width + 2))]),
      blank(),
      ...status,
    ]
  }

  function dispatch([name = '', ...args]: string[]): Line[] {
    const command = lookup(name)
    if (command) return command.run(args)
    const guess = closest(name, visible.map((c) => c.name))
    return [line(seg(`${name}: command not found. `, 'error'), ...(guess ? [seg('Did you mean ', 'dim'), runSeg(guess), seg('?', 'dim')] : [seg('Try ', 'dim'), runSeg('help')]))]
  }

  return {
    prompt: () => `${USER}@${HOST}:${display(cwd)}$`,
    cwd: () => display(cwd),
    echo,
    welcome,
    history: () => history,
    clearHistory: () => {
      history = []
    },

    run(input, { record = true } = {}) {
      const typed = input.trim()
      if (!typed) return []
      // History expansion: !! is the last command, !3 the third.
      const expanded = typed.replace(/!(!|\d+)/g, (match, which: string) => (which === '!' ? (history.at(-1) ?? match) : (history[Number(which) - 1] ?? match)))
      if (/!(!|\d+)/.test(expanded) && expanded === typed) return [error(`${typed}: event not found`)]
      if (record && history.at(-1) !== expanded) history.push(expanded)
      const out: Line[] = expanded === typed ? [] : [line(seg(expanded, 'dim'))]
      for (const { tokens, op } of parse(expanded)) {
        if (!tokens.length) continue
        const lines = dispatch(tokens)
        out.push(...lines)
        if (op === '&&' && lines.some((l) => l.segments.some((s) => s.style === 'error'))) break
      }
      return out
    },

    complete(input) {
      const cut = input.search(/\S+$/)
      const current = cut < 0 ? '' : input.slice(cut)
      const before = cut < 0 ? input : input.slice(0, cut)
      const [name] = before.trim().split(/\s+/)
      const first = !before.trim()
      let candidates: string[]
      if (first) candidates = visible.map((c) => c.name).filter((n) => n.startsWith(current))
      else {
        const kind = lookup(name ?? '')?.completes
        candidates =
          kind === 'path' || kind === 'dir'
            ? completePath(root, cwd, current, kind === 'dir')
            : kind === 'command'
              ? visible.map((c) => c.name).filter((n) => n.startsWith(current))
              : kind === 'view' || kind === 'toggle'
                ? (kind === 'view' ? ['paper', 'terminal'] : ['on', 'off']).filter((v) => v.startsWith(current))
                : []
      }
      if (!candidates.length) return { value: input, options: [] }
      if (candidates.length === 1) {
        const [only] = candidates as [string]
        return { value: before + only + (only.endsWith('/') ? '' : ' '), options: [] }
      }
      const prefix = commonPrefix(candidates)
      if (prefix.length > current.length) return { value: before + prefix, options: [] }
      // Several choices and nothing more to fill in: show them (just their names).
      return { value: input, options: candidates.map((c) => c.replace(/.*\/(?=.)/, '')) }
    },
  }
}

// --- Parsing ---

/**
 * Commands separated by ; or && (outside quotes), each split into words, with
 * the operator that follows it. Quotes group words.
 */
export function parse(input: string): Array<{ tokens: string[]; op: ';' | '&&' | null }> {
  const commands: Array<{ tokens: string[]; op: ';' | '&&' | null }> = []
  let tokens: string[] = []
  let word = ''
  let quoted = false
  let quote: string | null = null
  const endWord = () => {
    if (word || quoted) tokens.push(word)
    word = ''
    quoted = false
  }
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!
    if (quote) {
      if (ch === quote) quote = null
      else word += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      quoted = true
    } else if (ch === ';' || (ch === '&' && input[i + 1] === '&')) {
      endWord()
      commands.push({ tokens, op: ch === ';' ? ';' : '&&' })
      tokens = []
      if (ch === '&') i++
    } else if (/\s/.test(ch)) endWord()
    else word += ch
  }
  endWord()
  commands.push({ tokens, op: null })
  return commands
}

// --- Helpers ---

const normalize = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

function commonPrefix(words: string[]) {
  let prefix = words[0] ?? ''
  for (const word of words) while (!word.startsWith(prefix)) prefix = prefix.slice(0, -1)
  return prefix
}

/** The known command nearest to a typo (at most two edits away). */
function closest(typo: string, names: string[]) {
  let best: string | undefined
  let bestDistance = 3
  for (const name of names) {
    const d = distance(typo.toLowerCase(), name)
    if (d < bestDistance) [best, bestDistance] = [name, d]
  }
  return best
}

function distance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]!
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const above = row[j]!
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = above
    }
  }
  return row[b.length]!
}

/** Everything grep looks through for one story, its prose first; the rest is labelled when it matches. */
function searchable(item: Item): Array<{ label?: string; text: string }> {
  const prose = [item.headline, item.title, item.org, item.role, item.blurb, plainText(item.bodyHtml)].filter(Boolean).join(' · ').replace(/\s+/g, ' ')
  return [
    { text: prose },
    { label: 'outcomes', text: item.outcomes.join(' · ') },
    { label: 'stack', text: item.stack.join(', ') },
    { label: 'tags', text: item.tags.join(', ') },
  ].filter((field) => field.text)
}

/** HTML to plain text: tags dropped, the entities marked writes decoded. */
export function plainText(html: string) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (_, e: string) => {
      const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
      if (e[0] !== '#') return named[e.toLowerCase()] ?? ''
      return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    })
    .replace(/\s+/g, ' ')
    .trim()
}

/** The technologies that come up in the most stories. */
function topStack(items: Item[], n: number) {
  const counts = new Map<string, number>()
  for (const item of items) for (const tech of item.stack) counts.set(tech, (counts.get(tech) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, n).map(([tech]) => tech)
}

/** A moment (like the build time) as a date in Toronto. Calendar dates use formatShortDate. */
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Toronto' })

/** "Thu Sep 24 16:02" */
const lastLogin = (d: Date) =>
  `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '')} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
const clock = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

/** Like `date`: "Thu Sep 24 16:04:12 EDT 2026". */
function unixDate(d: Date) {
  const part = (options: Intl.DateTimeFormatOptions) => d.toLocaleString('en-US', options)
  const zone = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value ?? ''
  return `${part({ weekday: 'short' })} ${part({ month: 'short' })} ${String(d.getDate()).padStart(2, ' ')} ${clock(d)} ${zone} ${d.getFullYear()}`
}

// "KC" in figlet's standard font.
const LOGO = [' _  __  ____ ', '| |/ / / ___|', "| ' / | |    ", '| . \\ | |___ ', '|_|\\_\\ \\____|']

/** Uptime the way uptime(1) says it: "1 day, 23:12", "3:05", "12 min". */
function upFor(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  const days = Math.floor(minutes / 1440)
  const clockPart = `${Math.floor((minutes % 1440) / 60)}:${String(minutes % 60).padStart(2, '0')}`
  if (days) return `${days} day${days === 1 ? '' : 's'}, ${clockPart}`
  return minutes >= 60 ? clockPart : `${minutes} min`
}
