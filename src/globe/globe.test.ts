import { describe, expect, test } from 'bun:test'
import { feature } from 'topojson-client'
import type { GeometryCollection, Topology } from 'topojson-specification'
import topology from 'world-atlas/land-110m.json'
import { DOTS, landBits, landPoints, spiral, toLatLng, toVector, type Polygons } from './land'

const world = topology as unknown as Topology<{ land: GeometryCollection }>
const polygons: Polygons = feature(world, world.objects.land).features.flatMap(({ geometry }) =>
  geometry.type === 'MultiPolygon' ? geometry.coordinates : geometry.type === 'Polygon' ? [geometry.coordinates] : [],
)
const bits = landBits(polygons)
const bytes = Uint8Array.from(atob(bits), (c) => c.charCodeAt(0))
const isLand = (i: number) => !!(bytes[i >> 3]! & (1 << (i & 7)))

/** The dot nearest a place. */
function nearest(lat: number, lng: number) {
  const [x, y, z] = toVector(lat, lng)
  let best = 0
  let score = -2
  for (let i = 0; i < DOTS; i++) {
    const [a, b, c] = spiral(i)
    const dot = a * x + b * y + c * z
    if (dot > score) [best, score] = [i, dot]
  }
  return best
}

describe('the land', () => {
  test('coordinates go both ways', () => {
    const [lat, lng] = toLatLng(toVector(43.65, -79.38))
    expect(lat).toBeCloseTo(43.65, 6)
    expect(lng).toBeCloseTo(-79.38, 6)
    // 0°, 0° faces a camera on +z; east is +x.
    expect(toVector(0, 0).map((v) => Math.round(v))).toEqual([0, 0, 1])
    expect(toVector(0, 90).map((v) => Math.round(v))).toEqual([1, 0, 0])
  })

  test('Toronto, Kuwait City and the Sahara are land; the Atlantic and the Pacific are sea', () => {
    expect(isLand(nearest(43.65, -79.38 - 1.5))).toBe(true) // just west of Toronto (the city is on the lake)
    expect(isLand(nearest(29.38, 47.5))).toBe(true)
    expect(isLand(nearest(23, 12))).toBe(true)
    expect(isLand(nearest(35, -40))).toBe(false)
    expect(isLand(nearest(0, -140))).toBe(false)
  })

  test('about 30% of the dots are land, and they decode to points on the sphere', () => {
    const points = landPoints(bits)
    const share = points.length / 3 / DOTS
    expect(share).toBeGreaterThan(0.26)
    expect(share).toBeLessThan(0.34)
    const [x, y, z] = [points[0]!, points[1]!, points[2]!]
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 5)
  })
})

describe('where the stories go', async () => {
  const { loadSite } = await import('../content/load')
  const { places, frontOrder, CITIES } = await import('./places')
  const { pins, arcMiddle, ARC_HEIGHT } = await import('./pins')
  const site = await loadSite({ includeDrafts: false })
  const where = places(site)
  const angle = (a: [number, number], b: [number, number]) => {
    const [x1, y1, z1] = toVector(...a)
    const [x2, y2, z2] = toVector(...b)
    return (Math.acos(Math.min(1, x1 * x2 + y1 * y2 + z1 * z2)) * 180) / Math.PI
  }

  test('Toronto (home, and anything without a place), Kuwait City, and the journey between', () => {
    expect(where.toronto[0]!.slug).toBe(site.config.lead)
    expect(where.toronto.map((i) => i.slug)).toContain('hobby-guitar')
    expect(where.kuwait.map((i) => i.slug)).toEqual(expect.arrayContaining(['amantec', 'tedx', 'swarm-robots']))
    expect(where.between.map((i) => i.slug)).toEqual(['kuwait-toronto'])
    expect(where.toronto.length + where.kuwait.length + where.between.length).toBe(frontOrder(site).length)
  })

  test("every story gets a dot near its city, spiralling out from it, and none sit on each other or on the city", () => {
    const all = pins(where)
    expect(all.length).toBe(site.items.length)
    for (const pin of all.filter((p) => p.city !== 'between')) {
      const city = CITIES[pin.city as 'toronto' | 'kuwait']
      const away = angle([pin.lat, pin.lng], [city.lat, city.lng])
      expect(away).toBeGreaterThan(3)
      expect(away).toBeLessThan(25)
    }
    // The front page's first story is the nearest to its city.
    const toronto = all.filter((p) => p.city === 'toronto').map((p) => angle([p.lat, p.lng], [CITIES.toronto.lat, CITIES.toronto.lng]))
    expect(Math.min(...toronto)).toBe(toronto[0]!)
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i]!
        const b = all[j]!
        if (a.city === b.city) expect(angle([a.lat, a.lng], [b.lat, b.lng])).toBeGreaterThan(2.5)
      }
    }
  })

  test('the story about the move floats above the middle of the arc', () => {
    const [lat, lng] = arcMiddle()
    const toToronto = angle([lat, lng], [CITIES.toronto.lat, CITIES.toronto.lng])
    const toKuwait = angle([lat, lng], [CITIES.kuwait.lat, CITIES.kuwait.lng])
    expect(Math.abs(toToronto - toKuwait)).toBeLessThan(0.01)
    const between = pins(where).find((p) => p.city === 'between')!
    expect(between.radius).toBe(1 + ARC_HEIGHT)
  })
})

describe('labels', async () => {
  const { placeLabels } = await import('./labels')
  const box = { width: 400, height: 300 }

  test('each goes on the first free side of its dot, in order, and a label with no room is left out', () => {
    const placed = placeLabels(
      [
        { id: 'a', x: 100, y: 100, width: 60, height: 14, gap: 12 },
        { id: 'b', x: 104, y: 100, width: 60, height: 14, gap: 12 },
        { id: 'c', x: 102, y: 100, width: 60, height: 14, gap: 12 },
        { id: 'd', x: 103, y: 101, width: 60, height: 14, gap: 12 },
        { id: 'e', x: 101, y: 99, width: 60, height: 14, gap: 12 },
      ],
      box,
    )
    expect(placed.map((p) => [p.id, p.side])).toEqual([
      ['a', 'right'],
      ['b', 'left'],
      ['c', 'above'],
      ['d', 'below'],
    ])
  })

  test('labels stay inside the globe, and city names only go above or below', () => {
    const [edge] = placeLabels([{ id: 'edge', x: 390, y: 150, width: 60, height: 14, gap: 6 }], box)
    expect(edge!.side).toBe('left')
    const [city] = placeLabels([{ id: 'city', x: 200, y: 150, width: 60, height: 14, gap: 9, sides: ['above', 'below'] }], box)
    expect(city).toMatchObject({ side: 'above', x: 170, y: 127 })
  })
})
