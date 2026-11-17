import { SPACING, type Point } from './layout.ts'

const HALF = SPACING / 2

/**
 * Walk from one house to another along the streets: out to the nearest corner, along the street,
 * then to the other house. Houses sit mid-cell and streets run between cells, so nobody cuts through a yard.
 */
export function routeBetween(a: Point, b: Point): Point[] {
  if (a.x === b.x && a.z === b.z) return [a]
  const raw: Point[] = [
    a,
    { x: a.x + HALF, z: a.z + HALF },
    { x: b.x + HALF, z: a.z + HALF },
    { x: b.x + HALF, z: b.z + HALF },
    b,
  ]
  return raw.filter((point, index) => index === 0 || point.x !== raw[index - 1].x || point.z !== raw[index - 1].z)
}

const gap = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.z - a.z)

export function routeLength(points: readonly Point[]): number {
  let total = 0
  for (let index = 1; index < points.length; index++) total += gap(points[index - 1], points[index])
  return total
}

/** The spot `t` (0 to 1, clamped) of the way along the route, and which way to face. */
export function pointAt(points: readonly Point[], t: number): Point & { heading: number } {
  if (points.length === 0) return { x: 0, z: 0, heading: 0 }
  if (points.length === 1) return { ...points[0], heading: 0 }
  const clamped = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0))
  const target = routeLength(points) * clamped
  let walked = 0
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1]
    const to = points[index]
    const length = gap(from, to)
    if (walked + length >= target || index === points.length - 1) {
      const along = length === 0 ? 0 : (target - walked) / length
      return {
        x: from.x + (to.x - from.x) * along,
        z: from.z + (to.z - from.z) * along,
        heading: Math.atan2(to.x - from.x, to.z - from.z),
      }
    }
    walked += length
  }
  return { ...points[points.length - 1], heading: 0 }
}
