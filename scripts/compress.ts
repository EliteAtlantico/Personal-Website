// Runs after the prerender: a Brotli and a gzip copy of every text file in
// dist/, made once here at the highest settings, so the local server
// (server/site.ts) sends pages compressed the way visitors get them, for the
// perf harness. Cloudflare doesn't upload them (.assetsignore): it compresses
// by itself.
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'

const dist = path.resolve('dist')
const TEXT = /\.(html|css|js|mjs|json|svg|txt|xml)$/
/** Below this, compressing isn't worth a second file. */
const SMALL = 1024

let count = 0
let saved = 0
for (const file of await files(dist)) {
  if (!TEXT.test(file)) continue
  const body = await readFile(file)
  if (body.length < SMALL) continue
  const br = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: body.length } })
  const gz = gzipSync(body, { level: 9 })
  await writeFile(`${file}.br`, br)
  await writeFile(`${file}.gz`, gz)
  count++
  saved += body.length - br.length
}
await writeFile(path.join(dist, '.assetsignore'), '*.br\n*.gz\n')
console.log(`compressed ${count} files (Brotli saves ${Math.round(saved / 1024)} KB)`)

async function files(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const name of await readdir(dir)) {
    const full = path.join(dir, name)
    if ((await stat(full)).isDirectory()) out.push(...(await files(full)))
    else out.push(full)
  }
  return out
}
