// Where each story's dot goes. A city's stories spiral out from it like the
// seeds of a sunflower, the first (in the front page's order) nearest the
// city, with the city itself left clear for its marker. The story about going
// from one city to the other sits on top of the arc between them.
import { CITIES, type Places } from './places'
import { toLatLng, toVector } from './land'

/** Roughly how far apart neighbouring dots are, in degrees. */
const SPACING = 4.6
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
/** How high the arc between the cities rises at its middle, in globe radii. */
export const ARC_HEIGHT = 0.24

export interface Pin {
  slug: string
  lat: number
  lng: number
  /** Distance from the globe's centre (1 is the surface). */
  radius: number
  city: 'toronto' | 'kuwait' | 'between'
}

/** Dots sit just above the land's dots. */
export const SURFACE = 1.004

export function pins(places: Places): Pin[] {
  const out: Pin[] = []
  for (const id of ['toronto', 'kuwait'] as const) {
    const city = CITIES[id]
    places[id].forEach((item, i) => {
      const distance = SPACING * Math.sqrt(i + 1.4)
      const angle = (i + 1) * GOLDEN_ANGLE
      const lat = city.lat + distance * Math.sin(angle)
      const lng = city.lng + (distance * Math.cos(angle)) / Math.cos((lat * Math.PI) / 180)
      out.push({ slug: item.slug, lat, lng, radius: SURFACE, city: id })
    })
  }
  const [lat, lng] = arcMiddle()
  places.between.forEach((item, i) => out.push({ slug: item.slug, lat: lat + i * SPACING, lng, radius: 1 + ARC_HEIGHT, city: 'between' }))
  return out
}

/** The point on the globe halfway along the shortest way from Kuwait City to Toronto. */
export function arcMiddle(): [number, number] {
  const a = toVector(CITIES.kuwait.lat, CITIES.kuwait.lng)
  const b = toVector(CITIES.toronto.lat, CITIES.toronto.lng)
  const mid: [number, number, number] = [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
  const length = Math.hypot(...mid)
  return toLatLng([mid[0] / length, mid[1] / length, mid[2] / length])
}
