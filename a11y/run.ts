// The accessibility suite: `bun run a11y [keyboard|motion|nojs|reflow|safari|lighthouse]`.
//
//   keyboard    every view with the keyboard alone: Tab order, traps, focus
//               that shows, and each view's own keys.
//   motion      with reduced motion asked for, nothing moves by itself.
//   nojs        with JavaScript off, every page is still complete and readable.
//   reflow      at 320 and 390 px wide, nothing scrolls sideways.
//   safari      in macOS's own WebKit, no text sticks out of its column: at
//               several widths, resized, zoomed, and with a minimum font size.
//   lighthouse  Lighthouse's accessibility, best-practice, SEO and performance
//               audits on each view, on a laptop and a phone.
//
// With none named, it runs them all. It tests what's built (bun run build),
// served here the way Cloudflare serves it, and exits with an error on
// anything worse than low.
import { failing, report, type Finding } from '../security/checks'
import { checkKeyboard } from './keyboard'
import { checkLighthouse } from './lighthouse'
import { checkMotion } from './motion'
import { checkNoJs } from './nojs'
import { checkReflow } from './reflow'
import { checkSafari } from './safari'

const named = process.argv.slice(2).filter((a) => !a.startsWith('-'))
const run = (suite: string) => !named.length || named.includes(suite)

const findings: Finding[] = []
if (run('keyboard')) findings.push(...(await checkKeyboard()))
if (run('motion')) findings.push(...(await checkMotion()))
if (run('nojs')) findings.push(...(await checkNoJs()))
if (run('reflow')) findings.push(...(await checkReflow()))
if (run('safari')) findings.push(...(await checkSafari()))
if (run('lighthouse')) findings.push(...(await checkLighthouse()))
report(findings)
process.exit(failing(findings) ? 1 : 0)
