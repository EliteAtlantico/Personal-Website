// What the repository and the build give away. The repository is public on
// GitHub, so everything ever committed (not only what's there now) is
// published: this reads every commit for secrets, phone numbers and private
// files, then checks what dist/ ships and the dependencies.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { Checks, type Finding } from './checks'

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })

const SECRETS: Array<[string, RegExp]> = [
  ['a private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY-----/],
  ['an AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['a GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/],
  ['a Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ['a Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['a Stripe key', /\b[sr]k_live_[0-9a-zA-Z]{20,}/],
  ['an OpenAI or Anthropic key', /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}/],
  ['a JSON web token', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['a Cloudflare tunnel credential', /"TunnelSecret"\s*:/],
  ['a password or token written into the code', /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*['"][^'"\s]{8,}['"]/i],
]

/** Phone numbers: Kuwaiti mobiles (8 digits from 5, 6 or 9, maybe after +965) and North American ones. */
const PHONES = [/(?:\+?965[\s.-]?)[569]\d{3}[\s.-]?\d{4}\b/g, /(?<![\d.])(?:\+?1[\s.-]?)?\(?[2-9]\d{2}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\d.])/g]

/** Files that must never be committed. */
const PRIVATE_FILES = [/\.(?:pem|key|p12|pfx|kdbx)$/i, /(?:^|\/)\.env(?:\.|$)/, /(?:^|\/)\.dev\.vars$/, /id_(?:rsa|ed25519|ecdsa)/, /(?:^|\/)KC_Resume\.pdf$/, /^resume\/.*\.pdf$/, /^resume\/private\.tex$/, /original\.tex$/, /^content\/private\/(?!\.gitignore$)/, /cloudflared.*\.json$/, /(?:^|\/)cert\.pem$/]

export function auditRepository(): Finding[] {
  const checks = new Checks('Repository and build')

  // --- Every line ever added, in every commit ---
  const history = git('log', '--all', '-p', '--no-color', '--no-ext-diff', '--format=commit %h')
  let commit = ''
  const secrets: string[] = []
  const phones = new Set<string>()
  for (const line of history.split('\n')) {
    if (line.startsWith('commit ')) commit = line.slice(7)
    if (!line.startsWith('+') || line.startsWith('+++')) continue
    for (const [what, pattern] of SECRETS) if (pattern.test(line)) secrets.push(`${what} in ${commit}: ${line.slice(1, 90).trim()}`)
    for (const pattern of PHONES) for (const match of line.matchAll(pattern)) phones.add(`${match[0].trim()} (${commit})`)
  }
  checks.expect('no secrets anywhere in the history (keys, tokens, passwords)', !secrets.length, 'critical', secrets.slice(0, 5).join(' | '))
  checks.expect('no phone numbers anywhere in the history', !phones.size, 'high', [...phones].slice(0, 8).join(', '))

  const files = new Set(git('log', '--all', '--name-only', '--format=').split('\n').filter(Boolean))
  const committed = [...files].filter((file) => PRIVATE_FILES.some((pattern) => pattern.test(file)))
  checks.expect('no private files were ever committed (résumés with the phone number, keys, .env, tunnel credentials)', !committed.length, 'high', committed.join(', '))

  const authors = [...new Set(git('log', '--all', '--format=%ae%n%ce').split('\n').filter(Boolean))]
  const personal = authors.filter((email) => !email.endsWith('@users.noreply.github.com'))
  checks.expect('commits carry GitHub\'s private no-reply address, not a personal email', !personal.length, 'low', personal.join(', '))

  // --- What would be committed next ---
  const ignored = (file: string) => {
    try {
      git('check-ignore', '-q', '--no-index', file)
      return true
    } catch {
      return false
    }
  }
  const mustIgnore = ['.env', '.env.local', '.dev.vars', 'key.pem', '.wrangler/state', 'resume/private.tex', 'resume/khalil_chaghouri_resume.pdf', 'KC_Resume.pdf', 'dist/index.html', 'build/server.mjs']
  const unignored = mustIgnore.filter((file) => !ignored(file))
  checks.expect('.gitignore keeps secrets and builds out of git', !unignored.length, 'medium', `not ignored: ${unignored.join(', ')}`)

  // --- The résumé that's published ---
  if (existsSync('public/resume.pdf')) {
    let text = ''
    try {
      text = execFileSync('pdftotext', ['-layout', 'public/resume.pdf', '-'], { encoding: 'utf8' })
    } catch {
      checks.expect('the published résumé could be read (pdftotext)', false, 'info')
    }
    const found = PHONES.flatMap((pattern) => [...text.matchAll(pattern)].map((m) => m[0]))
    if (text) checks.expect('the published résumé (public/resume.pdf) has no phone number', !found.length, 'high', found.join(', '))
  }

  // --- What the build ships ---
  if (existsSync('dist')) {
    const shipped: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const file = path.join(dir, name)
        if (statSync(file).isDirectory()) walk(file)
        else shipped.push(path.relative('dist', file))
      }
    }
    walk('dist')
    const maps = shipped.filter((f) => f.endsWith('.map'))
    checks.expect('the build ships no source maps', !maps.length, 'low', `${maps.length} .map files (build without PERF_SOURCEMAP)`)
    const text = shipped.filter((f) => /\.(html|js|css|json|txt|xml|svg)$/.test(f)).map((f) => readFileSync(path.join('dist', f), 'utf8')).join('\n')
    const leaked = SECRETS.filter(([, pattern]) => pattern.test(text)).map(([what]) => what)
    checks.expect('the build has no secrets in it', !leaked.length, 'critical', leaked.join(', '))
    const numbers = PHONES.flatMap((pattern) => [...text.matchAll(pattern)].map((m) => m[0]))
    checks.expect('the build has no phone numbers in it', !numbers.length, 'high', [...new Set(numbers)].slice(0, 5).join(', '))
    const emails = [...new Set(text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? [])].filter((e) => !/\.(png|jpe?g|webp|svg|js|css)$/.test(e))
    checks.expect(`the only email address it publishes is the one meant to be public`, emails.every((e) => e === 'khalil.chaghouri@mail.utoronto.ca'), 'low', emails.join(', '))
    const server = shipped.filter((f) => /server|\.ts$|package\.json|\.env/.test(f))
    checks.expect("the build doesn't include the server's code or the project's files", !server.length, 'medium', server.join(', '))
  }

  // --- Dependencies with known vulnerabilities ---
  try {
    const audit = execFileSync(process.execPath, ['audit'], { encoding: 'utf8' })
    checks.expect('no dependency has a known vulnerability (bun audit)', /No vulnerabilities found/i.test(audit), 'high', audit.split('\n').slice(-6).join(' '))
  } catch (error) {
    const out = String((error as { stdout?: string }).stdout ?? error)
    checks.expect('no dependency has a known vulnerability (bun audit)', false, 'high', out.split('\n').filter(Boolean).slice(-8).join(' | '))
  }
  return checks.findings
}
