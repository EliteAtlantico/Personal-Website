// The globe's land, as dots. Points are spread evenly over the sphere (a
// Fibonacci spiral, so no crowding at the poles), and each one is either land
// or sea. Which is which is worked out once, at build time, from Natural
// Earth's coastlines (world-atlas, public domain) and shipped as one bit per
// point: about 5 KB for the whole world.
//
// Coordinates: y is north, and a camera on +z looks at 0°, 0° with east to
// its right. Latitudes and longitudes are in degrees.

/** How many points cover the sphere (about 1° apart). */
export const DOTS = 40_000

const GOLDEN = Math.PI * (3 - Math.sqrt(5))

/** The i-th of n evenly spread points, as a unit vector. */
export function spiral(i: number, n = DOTS): [number, number, number] {
  const y = 1 - (2 * (i + 0.5)) / n
  const r = Math.sqrt(1 - y * y)
  const t = i * GOLDEN
  return [Math.cos(t) * r, y, Math.sin(t) * r]
}

export function toVector(lat: number, lng: number, radius = 1): [number, number, number] {
  const a = (lat * Math.PI) / 180
  const b = (lng * Math.PI) / 180
  return [radius * Math.cos(a) * Math.sin(b), radius * Math.sin(a), radius * Math.cos(a) * Math.cos(b)]
}

export function toLatLng([x, y, z]: [number, number, number]): [number, number] {
  return [(Math.asin(Math.max(-1, Math.min(1, y))) * 180) / Math.PI, (Math.atan2(x, z) * 180) / Math.PI]
}

// --- Build time (vite.config.ts): which points are land ---

/** GeoJSON MultiPolygon coordinates: polygons, each an outer ring and its holes, in [lng, lat]. */
export type Polygons = number[][][][]

/** One bit per point, set for land, as base64. */
export function landBits(polygons: Polygons, n = DOTS): string {
  const boxes = polygons.map((rings) => {
    let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity]
    for (const [lng, lat] of rings[0]!) {
      west = Math.min(west, lng!)
      east = Math.max(east, lng!)
      south = Math.min(south, lat!)
      north = Math.max(north, lat!)
    }
    return { rings, west, south, east, north }
  })
  const bits = new Uint8Array(Math.ceil(n / 8))
  for (let i = 0; i < n; i++) {
    const [lat, lng] = toLatLng(spiral(i, n))
    const land = boxes.some(
      (box) => lat >= box.south && lat <= box.north && lng >= box.west && lng <= box.east && inside(box.rings[0]!, lng, lat) && !box.rings.slice(1).some((hole) => inside(hole, lng, lat)),
    )
    if (land) bits[i >> 3]! |= 1 << (i & 7)
  }
  return Buffer.from(bits).toString('base64')
}

/** Ray casting: does the ring contain the point? */
function inside(ring: number[][], x: number, y: number) {
  let hit = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!
    const [xj, yj] = ring[j]!
    if (yi! > y !== yj! > y && x < ((xj! - xi!) * (y - yi!)) / (yj! - yi!) + xi!) hit = !hit
  }
  return hit
}

// --- In the browser: the land points ---

/** The land's points as xyz triples, for a points geometry. */
export function landPoints(bits: string, n = DOTS): Float32Array {
  const bytes = Uint8Array.from(atob(bits), (c) => c.charCodeAt(0))
  const out: number[] = []
  for (let i = 0; i < n; i++) if (bytes[i >> 3]! & (1 << (i & 7))) out.push(...spiral(i, n))
  return new Float32Array(out)
}
