// The only thing this site keeps: choices the visitor made themselves (turning
// personalizing off or on, and which view they switched to), in their own
// browser's localStorage. `forget` in the terminal, or "Forget my choices" in
// the panel, clears it.
import type { Prefs } from './decide'

const KEY = 'kc:prefs'

export function readPrefs(): Prefs {
  try {
    const prefs = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Prefs
    return {
      personalize: typeof prefs.personalize === 'boolean' ? prefs.personalize : undefined,
      view: prefs.view === 'paper' || prefs.view === 'terminal' ? prefs.view : undefined,
    }
  } catch {
    return {}
  }
}

export function writePrefs(change: Prefs) {
  try {
    const next = { ...readPrefs(), ...change }
    for (const key of Object.keys(next) as Array<keyof Prefs>) if (next[key] === undefined) delete next[key]
    if (Object.keys(next).length) localStorage.setItem(KEY, JSON.stringify(next))
    else localStorage.removeItem(KEY)
  } catch {
    // Storage is off (private windows, some settings): the choice lasts until the page closes.
  }
}

export function forgetPrefs() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing was stored.
  }
}
