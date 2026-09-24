// What's holding on to a leak: `bun perf/retainers.ts <scenario> <what> [rounds]`.
//
// Runs a leak scenario (perf/leaks.ts, matched by part of its name), takes a
// heap snapshot, finds the detached DOM nodes whose name contains <what>
// ("div", "page", "canvas"...) and prints, for a few of them, the shortest
// chain of references from something that's always alive (a GC root) down to
// them: what a fix has to cut. The same thing Chrome's DevTools shows as
// "Retainers", without opening DevTools.
import { SCENARIOS } from './leaks'
import { gc, launch, openPage, ready, serve, sleep } from './lib'

//
// With `--growth` instead of <what>, it compares a snapshot taken after two
// warm-up rounds with one taken after the rounds, and lists what there's
// more of (by constructor): what's piling up, when it isn't a DOM node.
const [scenarioName = '', what = '', roundsArg] = process.argv.slice(2)
const scenario = SCENARIOS.find((s) => s.name.includes(scenarioName))
if (!scenario || !what) {
  console.log(`Usage: bun perf/retainers.ts <scenario> <what>|--growth [rounds]\nScenarios:\n${SCENARIOS.map((s) => `  ${s.name}`).join('\n')}`)
  process.exit(1)
}

const server = await serve()
const browser = await launch({ steady: true })
const { page, cdp, close } = await openPage(browser, 'desktop', { network: false })
const snapshot = async () => {
  await sleep(2500)
  await gc(page, cdp)
  let json = ''
  const collect = ({ chunk }: { chunk: string }) => (json += chunk)
  cdp.on('HeapProfiler.addHeapSnapshotChunk', collect)
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false })
  cdp.off('HeapProfiler.addHeapSnapshotChunk', collect)
  return JSON.parse(json) as Snapshot
}
try {
  await page.goto(server.url + scenario.route, { waitUntil: 'load' })
  await ready(page)
  await sleep(1500)
  const rounds = Number(roundsArg ?? 3)
  if (what === '--growth') {
    for (let i = 0; i < 2; i++) await scenario.step(page)
    const before = tally(await snapshot())
    for (let i = 0; i < rounds; i++) await scenario.step(page)
    const after = tally(await snapshot())
    const rows = [...after].map(([name, a]) => ({ name, count: a.count - (before.get(name)?.count ?? 0), size: a.size - (before.get(name)?.size ?? 0) }))
    console.log(`What there's more of after ${rounds} rounds (count, bytes):`)
    for (const row of rows.filter((r) => r.size > 0).sort((a, b) => b.size - a.size).slice(0, 25)) {
      console.log(`${String(row.count).padStart(7)} ${String(row.size).padStart(10)}  ${row.name.slice(0, 100)}`)
    }
  } else {
    for (let i = 0; i < rounds; i++) await scenario.step(page)
    report(await snapshot(), what)
  }
} finally {
  await close()
  await browser.close()
  server.close()
}

/** Objects by kind ("Array", "HTMLDivElement", a class's name, a closure's...): how many, and their own bytes. */
function tally(heap: Snapshot) {
  const { node_fields, node_types } = heap.snapshot.meta
  const N = node_fields.length
  const [TYPE, NAME, SIZE] = [node_fields.indexOf('type'), node_fields.indexOf('name'), node_fields.indexOf('self_size')]
  const totals = new Map<string, { count: number; size: number }>()
  for (let n = 0; n < heap.nodes.length / N; n++) {
    const type = node_types[0][heap.nodes[n * N + TYPE]!]!
    let name = heap.strings[heap.nodes[n * N + NAME]!]!
    // Strings and code are grouped by kind; everything else by its name.
    if (type === 'string' || type === 'concatenated string' || type === 'sliced string') name = '(string)'
    else if (type === 'code') name = '(compiled code)'
    else if (type === 'closure') name = `${name || '(anonymous)'}()`
    else if (type === 'array') name = `(array) ${name}`
    else if (type === 'native') name = name.replace(/\s.*$/, '').replace(/^<(\w+).*/, '<$1>')
    const total = totals.get(name) ?? { count: 0, size: 0 }
    total.count++
    total.size += heap.nodes[n * N + SIZE]!
    totals.set(name, total)
  }
  return totals
}

interface Snapshot {
  snapshot: { meta: { node_fields: string[]; node_types: [string[]]; edge_fields: string[]; edge_types: [string[]] } }
  nodes: number[]
  edges: number[]
  strings: string[]
}

function report(heap: Snapshot, what: string) {
  const { node_fields, node_types, edge_fields, edge_types } = heap.snapshot.meta
  const N = node_fields.length
  const E = edge_fields.length
  const field = (name: string) => node_fields.indexOf(name)
  const [TYPE, NAME, EDGES, DETACHED] = [field('type'), field('name'), field('edge_count'), field('detachedness')]
  const [ETYPE, ENAME, ETO] = [edge_fields.indexOf('type'), edge_fields.indexOf('name_or_index'), edge_fields.indexOf('to_node')]
  const count = heap.nodes.length / N
  const name = (n: number) => heap.strings[heap.nodes[n * N + NAME]!]!
  const type = (n: number) => node_types[0][heap.nodes[n * N + TYPE]!]!

  // Who points at whom, backwards.
  const retainers: Array<Array<[from: number, edge: string]>> = Array.from({ length: count }, () => [])
  let edge = 0
  for (let n = 0; n < count; n++) {
    for (let e = 0; e < heap.nodes[n * N + EDGES]!; e++, edge += E) {
      const kind = edge_types[0][heap.edges[edge + ETYPE]!]!
      if (kind === 'weak') continue
      const to = heap.edges[edge + ETO]! / N
      const label = kind === 'element' || kind === 'hidden' ? `[${heap.edges[edge + ENAME]}]` : String(heap.strings[heap.edges[edge + ENAME]!])
      retainers[to]!.push([n, `${kind === 'context' ? 'closure var ' : ''}${label}`])
    }
  }

  const targets: number[] = []
  for (let n = 0; n < count; n++) {
    if (DETACHED >= 0 && heap.nodes[n * N + DETACHED] === 2 && type(n) === 'native' && name(n).toLowerCase().includes(what.toLowerCase())) targets.push(n)
  }
  console.log(`${targets.length} detached nodes named like "${what}"`)
  const seen = new Set<string>()
  for (const target of targets.slice(0, 40)) {
    // Breadth-first back to the root (node 0), the shortest chain first.
    const via = new Map<number, [number, string]>([[target, [-1, '']]])
    const queue = [target]
    let found = -1
    while (queue.length && found < 0) {
      const n = queue.shift()!
      for (const [from, label] of retainers[n]!) {
        if (via.has(from)) continue
        via.set(from, [n, label])
        if (from === 0) {
          found = from
          break
        }
        queue.push(from)
      }
    }
    if (found < 0) continue
    const chain: string[] = []
    for (let n = found; n !== target; ) {
      const [next, label] = via.get(n)!
      if (n !== 0) chain.push(`${name(n).slice(0, 70)} (${type(n)})`)
      chain.push(`  .${label} ->`)
      n = next
    }
    chain.push(`${name(target).slice(0, 90)}`)
    const text = chain.join('\n')
    // Many nodes of one leaked tree share a chain; show each chain once.
    const key = chain.slice(0, -1).join('|')
    if (seen.has(key)) continue
    seen.add(key)
    console.log(`\n${text}`)
    if (seen.size >= 4) break
  }
}
