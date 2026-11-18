/** Browser geocode helpers: localStorage first, then shared GET /api/geocode. */

import { apiBase, authHeaders } from '../api/client.ts'

export type MapCenter = {
  longitude: number
  latitude: number
  label: string
}

const CACHE_PREFIX = 'relay:geocode:v4:'

let geocodeFetch: typeof fetch = fetch

/** Test seam for unit / flow mocks. */
export function setGeocodeFetchForTests(fn: typeof fetch | null): void {
  geocodeFetch = fn ?? fetch
}

export function addressQuery(street: string, city: string): string {
  const parts = [street.trim(), city.trim()].filter(Boolean)
  if (parts.length === 0) return ''
  return `${parts.join(', ')}, United States`
}

export function cacheKeyForAddress(street: string, city: string): string {
  return `${CACHE_PREFIX}${addressQuery(street, city).toLowerCase()}`
}

export function readCachedCenter(street: string, city: string): MapCenter | null {
  const query = addressQuery(street, city)
  if (!query || typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(cacheKeyForAddress(street, city))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<MapCenter>
    if (
      typeof parsed.longitude !== 'number' ||
      typeof parsed.latitude !== 'number' ||
      !Number.isFinite(parsed.longitude) ||
      !Number.isFinite(parsed.latitude)
    ) {
      return null
    }
    return {
      longitude: parsed.longitude,
      latitude: parsed.latitude,
      label: typeof parsed.label === 'string' && parsed.label ? parsed.label : query,
    }
  } catch {
    return null
  }
}

export function writeCachedCenter(street: string, city: string, center: MapCenter): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(cacheKeyForAddress(street, city), JSON.stringify(center))
  } catch {
    /* quota / private mode */
  }
}

type ApiGeocodeCenter = {
  longitude: number
  latitude: number
  label: string
  cache_hit?: boolean
}

/**
 * Geocode "street, city" via the shared backend cache (and localStorage).
 * Pass a verified profile center when available to skip the network entirely.
 */
export async function geocodeAddress(
  street: string,
  city: string,
  _token?: string,
  fetchImpl: typeof fetch = geocodeFetch,
): Promise<MapCenter | null> {
  const query = addressQuery(street, city)
  if (!query) return null

  const cached = readCachedCenter(street, city)
  if (cached) return cached

  const params = new URLSearchParams({ q: query, city: city.trim() })
  const response = await fetchImpl(`${apiBase}/api/geocode?${params.toString()}`, {
    headers: await authHeaders(),
  })
  if (response.status === 429 || response.status === 503 || !response.ok) return null
  const body = (await response.json()) as ApiGeocodeCenter
  if (
    typeof body.longitude !== 'number' ||
    typeof body.latitude !== 'number' ||
    !Number.isFinite(body.longitude) ||
    !Number.isFinite(body.latitude)
  ) {
    return null
  }
  const center: MapCenter = {
    longitude: body.longitude,
    latitude: body.latitude,
    label: typeof body.label === 'string' && body.label ? body.label : query,
  }
  writeCachedCenter(street, city, center)
  return center
}

export function mapboxAccessToken(): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env
  const value = env?.VITE_MAPBOX_ACCESS_TOKEN
  return typeof value === 'string' ? value.trim() : ''
}
