// The security suite: `bun run security [server|worker|browser|repo|live|host]`.
//
//   server   the desk's server as it runs in production (build/server.mjs on
//            Node): reading files outside dist/, redirects off the site,
//            methods, malformed and smuggled requests, headers, errors.
//   worker   the Worker in front of it: fetching anything but the desk,
//            passing on the visitor's details, redirects, headers.
//   browser  the pages: script injection through everything a visitor or a
//            link controls, framing by other sites, requests elsewhere.
//   repo     the public repository and the build: secrets and phone numbers
//            anywhere in the history, private files, photos that say where
//            they were taken, what dist/ ships, and dependencies with known
//            vulnerabilities.
//   live     the site as deployed (live.ts has the address; give another
//            after it, or set SITE_URL): TLS, redirects, headers, what's
//            published, the Worker's defences, then the browser attacks on
//            the real pages. Real requests (a couple of thousand, most of
//            them the browser's), reading only.
//   host     the desk itself, over SSH, reading only (DESK=user@host). --host
//            works too.
//
// With none named, it runs the first four, which test what's built here, so
// build first (bun run build && bun run build:server). live and host reach
// other machines, so they run only when named. It exits with an error on
// anything worse than low.
import { attackBrowser } from './browser'
import { failing, report, type Finding } from './checks'
import { auditHost } from './host'
import { attackLive, LIVE } from './live'
import { auditRepository } from './repo'
import { attackServer } from './server'
import { attackWorker } from './worker'

const args = process.argv.slice(2)
const address = args.find((a) => /^https?:\/\//.test(a)) ?? process.env.SITE_URL
const named = args.filter((a) => !a.startsWith('-') && a !== address)
// An address on the command line means the live suite.
if (address && !process.env.SITE_URL) named.push('live')
const run = (suite: string) => named.includes(suite) || (!named.length && ['server', 'worker', 'browser', 'repo'].includes(suite))

const findings: Finding[] = []
if (run('server')) findings.push(...(await attackServer()))
if (run('worker')) findings.push(...(await attackWorker()))
if (run('browser')) findings.push(...(await attackBrowser()))
if (run('repo')) findings.push(...auditRepository())
if (run('live')) findings.push(...(await attackLive(address ?? LIVE)))
if (run('host') || args.includes('--host')) findings.push(...auditHost())
report(findings)
process.exit(failing(findings) ? 1 : 0)
