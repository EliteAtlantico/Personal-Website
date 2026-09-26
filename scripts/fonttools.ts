// Python's fontTools, for the scripts that read the site's fonts (fonts.ts,
// icons.ts). The fonts are WOFF2, which fontTools needs Brotli for: if
// Python has no brotli module, it gets Bun's, through a stand-in module.
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

let env: NodeJS.ProcessEnv | undefined

/** Runs python3 with `args` (fontTools importable, WOFF2 readable and writable), and returns what it printed. */
export function python(args: string[], what: string) {
  env ??= withBrotli()
  const result = spawnSync('python3', args, { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`fontTools couldn't ${what}:\n${result.stderr || result.error}`)
  return result.stdout
}

function withBrotli(): NodeJS.ProcessEnv {
  if (spawnSync('python3', ['-c', 'import brotli'], { stdio: 'ignore' }).status === 0) return process.env
  const shim = path.join(os.tmpdir(), 'kc-fonts-brotli')
  mkdirSync(shim, { recursive: true })
  writeFileSync(
    path.join(shim, 'brotli.py'),
    `# Brotli for fontTools' WOFF2, from Bun (written by scripts/fonttools.ts).
import subprocess
MODE_GENERIC, MODE_TEXT, MODE_FONT = 0, 1, 2
def _bun(script, data):
    return subprocess.run([${JSON.stringify(process.execPath)}, '-e', script], input=data, capture_output=True, check=True).stdout
def decompress(data):
    return _bun("process.stdout.write(require('node:zlib').brotliDecompressSync(require('fs').readFileSync(0)))", data)
def compress(data, mode=0, quality=11, lgwin=22, lgblock=0):
    return _bun("const z=require('node:zlib'),c=z.constants;process.stdout.write(z.brotliCompressSync(require('fs').readFileSync(0),{params:{[c.BROTLI_PARAM_MODE]:%d,[c.BROTLI_PARAM_QUALITY]:%d,[c.BROTLI_PARAM_LGWIN]:%d}}))" % (mode, quality, lgwin), data)
`,
  )
  return { ...process.env, PYTHONPATH: shim }
}
