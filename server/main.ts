// Starts the desk's server: the built site on localhost, for Cloudflare's
// tunnel to reach (deploy/kc-site.service runs it). Built into one file for
// Node with `bun run build:server`, so the desk needs nothing but Node.
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { site } from './site'

const here = path.dirname(fileURLToPath(import.meta.url))
const dist = process.env.SITE_DIST ?? path.join(here, 'dist')
const host = process.env.HOST ?? '127.0.0.1'
const port = Number(process.env.PORT ?? 8787)

const server = createServer(site({ dist }))
server.listen(port, host, () => console.log(`Serving ${dist} on http://${host}:${port}`))

// Stop cleanly when systemd says so (a deploy restarts it).
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 3000).unref()
  })
}
