// Where this page is being served from: live from the desk (Khalil's Arch
// desktop, through Cloudflare's tunnel, server/site.ts), or Cloudflare's copy
// of the site while the desk is asleep (edge/worker.ts). Asked once a visit;
// the paper's footer says it, and so does the terminal's `uptime`.

export type Desk =
  | { live: true; name: string; uptime: number; load: number[]; cpu: number | null; system: string; kernel: string; cores: number }
  | { live: false }

export interface Reading {
  desk: Desk
  /** When it was read (uptime keeps counting from there). */
  at: number
}

let asked: Promise<Reading | null> | undefined
let answer: Reading | null = null

/** The desk, asked once a visit. Null where there's no desk to ask (a plain static copy). */
export function desk(): Promise<Reading | null> {
  asked ??= fetch('/api/desk', { headers: { accept: 'application/json' } })
    .then(async (response) => {
      if (!response.ok || !response.headers.get('content-type')?.includes('json')) return null
      const body = (await response.json()) as Desk
      answer = typeof body?.live === 'boolean' ? { desk: body, at: Date.now() } : null
      return answer
    })
    .catch(() => null)
  return asked
}

/** The answer, if it's in (for code that can't wait, like the terminal's commands). */
export const deskSoFar = () => answer

/** Seconds as a person would say them: "1 day, 23 hours", "5 hours", "12 minutes". */
export function since(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  if (days) return [unit(days, 'day'), hours % 24 ? unit(hours % 24, 'hour') : ''].filter(Boolean).join(', ')
  if (hours) return unit(hours, 'hour')
  return unit(Math.max(1, minutes), 'minute')
}

/** The paper's line: "Served live from my Arch desktop · up 1 day, 23 hours." */
export function deskLine({ desk, at }: Reading, now = Date.now()) {
  if (!desk.live) return "My desk is asleep, so you're reading the copy Cloudflare keeps."
  return `Served live from ${desk.name} · up ${since(desk.uptime + (now - at) / 1000)}.`
}
