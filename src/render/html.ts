// Tiny helpers for building HTML strings safely. Every piece of content text
// goes through esc(); only pre-rendered Markdown (bodyHtml) is inserted raw.

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export const esc = (value: string) => value.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c)

/** Joins the truthy parts, so optional fragments can be written inline as `cond && html`. */
export const join = (parts: Array<string | false | 0 | null | undefined>) => parts.filter(Boolean).join('')

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-CA', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

/** "2026-09-23" → "Sep 23, 2026" (parsed as a calendar date, so no timezone shift). */
export const formatShortDate = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return ymd
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
