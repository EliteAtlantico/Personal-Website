// The load-in animations (the bio's snowfall, the banner's letters and the
// headlines' swarm) share one pace, so they always move together. Their
// timings are written for speed 1; at 2 they play twice as fast.
export const INTRO_SPEED = 2

/** A load-in timing, in ms, at the shared pace. */
export const intro = (ms: number) => ms / INTRO_SPEED
