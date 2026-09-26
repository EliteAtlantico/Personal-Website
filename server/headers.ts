// The security headers on every response, whoever sends it: Cloudflare, for
// the site's files (the build writes them into dist/_headers, from here), the
// Worker, for /api/visitor (edge/worker.ts), and the local server the tests
// and the perf harness use (server/site.ts).
//
// Pages carry the rest of their Content-Security-Policy themselves, in a
// <meta> tag the build writes (scripts/prerender.ts): only the build knows
// the hash of the page's one inline script. This header adds what a <meta>
// can't say: that no other site may put these pages in a frame.
export const SECURITY: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'content-security-policy': "frame-ancestors 'none'; object-src 'none'; base-uri 'none'",
  // Other sites' windows can't reach into this one, nor embed its files.
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
}

/** Browsers use HTTPS for the site (and its subdomains) for a year after seeing this. */
export const HSTS = 'max-age=31536000; includeSubDomains'

/** Files other sites are meant to show: the picture a shared link carries (scripts/og.ts), and the icons (scripts/icons.ts). They may be embedded anywhere. */
export const SHARED = ['/og.png', '/favicon.ico', '/favicon.svg', '/apple-touch-icon.png']

/** The security headers for one of the site's files, by its path. */
export function securityFor(path: string): Record<string, string> {
  if (!SHARED.includes(path)) return SECURITY
  const { 'cross-origin-resource-policy': _embeddable, ...rest } = SECURITY
  return rest
}

/** dist/_headers: Cloudflare's rules for the files it serves without the Worker. */
export function headersFile() {
  const rule = (pattern: string, lines: string[]) => [pattern, ...lines.map((line) => `  ${line}`)].join('\n')
  return `${[
    rule('/*', [...Object.entries(SECURITY).map(([name, value]) => `${name}: ${value}`), `strict-transport-security: ${HSTS}`]),
    ...SHARED.map((path) => rule(path, ['! cross-origin-resource-policy'])),
  ].join('\n')}\n`
}
