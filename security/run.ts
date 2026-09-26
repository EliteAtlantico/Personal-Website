// The security suite: `bun run security [worker|browser|repo|live]`.
//
//   worker   the Worker (edge/worker.ts), the site's only code on Cloudflare:
//            fetching anything at all, what /api/visitor hands back and to
//            whom, and headers.
//   browser  the pages: script injection through everything a visitor or a
//            link controls, framing by other sites, requests elsewhere.
//   repo     the public repository and the build: secrets and phone numbers
//            anywhere in the history, private files, photos that say where
//            they were taken, what dist/ ships, and dependencies with known
//            vulnerabilities.
//   live     the site as deployed (content/site.json has the address; give
//            another after it, or set SITE_URL): TLS, redirects, headers,
//            what's published, the Worker, then the browser attacks on the
//            real pages. Real requests (a couple of thousand, most of them
//            the browser's), reading only.
//
// With none named, it runs the first three, which test what's built here, so
// build first (bun run build). live reaches the real site, so it runs only
// when named. It exits with an error on anything worse than low.
import { attackBrowser } from './browser'
import { failing, report, type Finding } from './checks'
import { attackLive, LIVE } from './live'
import { auditRepository } from './repo'
import { attackWorker } from './worker'

const args = process.argv.slice(2)
const address = args.find((a) => /^https?:\/\//.test(a)) ?? process.env.SITE_URL
const named = args.filter((a) => !a.startsWith('-') && a !== address)
// An address on the command line means the live suite.
if (address && !process.env.SITE_URL) named.push('live')
const run = (suite: string) => named.includes(suite) || (!named.length && ['worker', 'browser', 'repo'].includes(suite))

const findings: Finding[] = []
if (run('worker')) findings.push(...(await attackWorker()))
if (run('browser')) findings.push(...(await attackBrowser()))
if (run('repo')) findings.push(...auditRepository())
if (run('live')) findings.push(...(await attackLive(address ?? LIVE)))
report(findings)
process.exit(failing(findings) ? 1 : 0)
