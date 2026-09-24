// The security headers on every response, whoever sends it: the desk
// (server/site.ts) or the Worker in front of it (edge/worker.ts).
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

/** Browsers use HTTPS for the site (and its subdomains) for a year after seeing this. Sent from the edge, where it's HTTPS. */
export const HSTS = 'max-age=31536000; includeSubDomains'
