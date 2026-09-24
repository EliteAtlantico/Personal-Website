// Finding a city's skyline in a daytime photo, for the typographic banner.
// Each column is scanned up from the waterline: the city is everything that is
// connected to the ground and isn't sky. "Sky" means close to the sky's own
// colour at that height, which changes from deep blue overhead to pale near the
// horizon, so it's fitted (per channel, as a straight line) from the clearly
// blue pixels of the rows above the buildings. Clouds never touch the ground,
// so the scan never reaches them.

export type RGB = [number, number, number]

/** How close to the sky's colour a pixel must be to count as sky. */
const SKY_DISTANCE = 26
/** Sky pixels a column may cross (a gap between floors, a thin mast) before the scan stops. */
const MAX_GAP = 3

/**
 * For each column in [0, width), the topmost row of the city, in the same pixel
 * units as `rgb`. `band` is the slice of the photo (top and bottom, as fractions
 * of its height) that is shown; its bottom edge should be the ground or water.
 */
export function findSkyline(
  rgb: (x: number, y: number) => RGB,
  width: number,
  height: number,
  band: [number, number] = [0, 1],
): Int16Array {
  const top = Math.round(band[0] * height)
  const bottom = Math.min(height - 1, Math.round(band[1] * height))
  const skyAt = fitSky(rgb, width, top + Math.round((bottom - top) * 0.16), top + Math.round((bottom - top) * 0.64))

  const edges = new Int16Array(width).fill(bottom)
  for (let x = 0; x < width; x++) {
    let gap = 0
    for (let y = bottom; y >= top; y--) {
      const p = rgb(x, y)
      const s = skyAt(y)
      if (Math.hypot(p[0] - s[0], p[1] - s[1], p[2] - s[2]) < SKY_DISTANCE) {
        if (++gap > MAX_GAP) break
      } else {
        gap = 0
        edges[x] = y
      }
    }
  }
  return edges
}

/** The sky's colour by row: the median clearly-blue pixel of each row from `from` to `to`, fitted with a line per channel. */
export function fitSky(rgb: (x: number, y: number) => RGB, width: number, from: number, to: number): (y: number) => RGB {
  const samples: Array<[number, RGB]> = []
  for (let y = from; y <= to; y += 2) {
    const row: RGB[] = []
    for (let x = 0; x < width; x += 3) {
      const p = rgb(x, y)
      if (p[2] > p[0] + 20) row.push(p)
    }
    // Rows that are mostly buildings or cloud say little about the sky.
    if (row.length < width / 18) continue
    const median = (c: number) => row.map((p) => p[c]!).sort((a, b) => a - b)[row.length >> 1]!
    samples.push([y, [median(0), median(1), median(2)]])
  }
  if (!samples.length) return () => [110, 160, 220]
  if (samples.length === 1) return () => samples[0]![1]

  const meanY = samples.reduce((sum, [y]) => sum + y, 0) / samples.length
  const lines = [0, 1, 2].map((c) => {
    const mean = samples.reduce((sum, [, p]) => sum + p[c]!, 0) / samples.length
    let num = 0
    let den = 0
    for (const [y, p] of samples) {
      num += (y - meanY) * (p[c]! - mean)
      den += (y - meanY) ** 2
    }
    const slope = den ? num / den : 0
    return { at0: mean - slope * meanY, slope }
  })
  return (y) => [lines[0]!.at0 + lines[0]!.slope * y, lines[1]!.at0 + lines[1]!.slope * y, lines[2]!.at0 + lines[2]!.slope * y]
}
