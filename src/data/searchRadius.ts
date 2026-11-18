/** Shared Neighborhood search radius (Map + 3D). */

export const RADIUS_STEPS = [1, 2, 5, 10, 25, 50] as const
export type RadiusMiles = (typeof RADIUS_STEPS)[number]
export const DEFAULT_RADIUS_MILES: RadiusMiles = 2
export const RADIUS_QUERY_DEBOUNCE_MS = 300
export const RADIUS_WIDEN_THRESHOLD = 5

const STORAGE_PREFIX = 'relay:search-radius:v1:'

export function isRadiusMiles(value: unknown): value is RadiusMiles {
  return typeof value === 'number' && (RADIUS_STEPS as readonly number[]).includes(value)
}

export function clampRadiusMiles(value: number): RadiusMiles {
  let best: RadiusMiles = DEFAULT_RADIUS_MILES
  let bestDelta = Number.POSITIVE_INFINITY
  for (const step of RADIUS_STEPS) {
    const delta = Math.abs(step - value)
    if (delta < bestDelta) {
      best = step
      bestDelta = delta
    }
  }
  return best
}

export function nextWiderRadius(current: RadiusMiles): RadiusMiles | null {
  const index = RADIUS_STEPS.indexOf(current)
  if (index < 0 || index >= RADIUS_STEPS.length - 1) return null
  return RADIUS_STEPS[index + 1]!
}

export function radiusStorageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId || 'anon'}`
}

export function readStoredRadius(userId: string): RadiusMiles {
  if (typeof localStorage === 'undefined') return DEFAULT_RADIUS_MILES
  try {
    const raw = localStorage.getItem(radiusStorageKey(userId))
    if (!raw) return DEFAULT_RADIUS_MILES
    const parsed = Number(raw)
    return isRadiusMiles(parsed) ? parsed : DEFAULT_RADIUS_MILES
  } catch {
    return DEFAULT_RADIUS_MILES
  }
}

export function writeStoredRadius(userId: string, miles: RadiusMiles): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(radiusStorageKey(userId), String(miles))
  } catch {
    /* private mode / quota */
  }
}

export function radiusLabel(miles: RadiusMiles): string {
  return `Within ${miles} mile${miles === 1 ? '' : 's'}`
}

/** Miles → degrees helpers for map circle fitting (approx). */
export function milesToLatDegrees(miles: number): number {
  return miles / 69.17
}

export function milesToLngDegrees(miles: number, latitude: number): number {
  const cos = Math.cos((latitude * Math.PI) / 180)
  if (Math.abs(cos) < 1e-6) return 0
  return miles / (69.17 * cos)
}

/** Haversine distance in miles (browser-side filter for Map/3D people). */
export function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * 3958.7613 * Math.asin(Math.min(1, Math.sqrt(a)))
}
