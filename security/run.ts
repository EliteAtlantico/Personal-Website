// The security suite: `bun run security [server|worker|browser|repo] [--host]`.
//
//   server   the desk's server as it runs in production (build/server.mjs on
//            Node): reading files outside dist/, redirects off the site,
//            methods, malformed and smuggled requests, headers, errors.
//   worker   the Worker in front of it: fetching anything but the desk,
//            passing on the visitor's details, redirects, headers.
//   browser  the pages: script injection through everything a visitor or a
//            link controls, framing by other sites, requests elsewhere.
//   repo     the public repository and the build: secrets and phone numbers
//            anywhere in the history, private files, what dist/ ships, and
//            dependencies with known vulnerabilities.
//   --host   also the desk itself, over SSH, reading only (DESK=user@host).
//
// With no suite named, it runs all four. It tests what's built, so build
// first (bun run build && bun run build:server). It exits with an error on
// anything worse than low.
import { attackBrowser } from './browser'
import { failing, report, type Finding } from './checks'
import { auditHost } from './host'
import { auditRepository } from './repo'
import { attackServer } from './server'
import { attackWorker } from './worker'

const args = process.argv.slice(2)
const suites = args.filter((a) => !a.startsWith('--'))
const run = (suite: string) => !suites.length || suites.includes(suite)

const findings: Finding[] = []
if (run('server')) findings.push(...(await attackServer()))
if (run('worker')) findings.push(...(await attackWorker()))
if (run('browser')) findings.push(...(await attackBrowser()))
if (run('repo')) findings.push(...auditRepository())
if (args.includes('--host')) findings.push(...auditHost())
report(findings)
process.exit(failing(findings) ? 1 : 0)
