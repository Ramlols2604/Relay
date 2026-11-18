/** Address suggestion acceptance rules + shared /api/geocode autocomplete. */

import { apiBase, authHeaders } from '../api/client.ts'

export const ADDRESS_DEBOUNCE_MS = 400
export const ADDRESS_MIN_CHARS = 4
export const ADDRESS_MAX_SUGGESTIONS = 5
export const ADDRESS_MIN_RELEVANCE = 0.9

export type VerifiedAddress = {
  street: string
  city: string
  state: string
  formattedAddress: string
  latitude: number
  longitude: number
}

export type AddressSuggestion = VerifiedAddress & {
  id: string
  placeName: string
  relevance: number
  featureType: string
}

type MapboxContext = {
  id?: string
  text?: string
  short_code?: string
}

type MapboxFeature = {
  id?: string
  place_name?: string
  text?: string
  address?: string
  relevance?: number
  place_type?: string[]
  center?: [number, number]
  context?: MapboxContext[]
}

type MapboxResponse = { features?: MapboxFeature[] }

let addressFetch: typeof fetch = fetch

/** Test seam for unit / flow mocks. */
export function setAddressFetchForTests(fn: typeof fetch | null): void {
  addressFetch = fn ?? fetch
}

function normalizeStreet(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function isDemoStreetAddress(street: string): boolean {
  return normalizeStreet(street).includes('14 willow court')
}

export function featureTypesIncludeAddress(placeType: string[] | undefined): boolean {
  return Boolean(placeType?.includes('address'))
}

export function cityMentioned(city: string, placeName: string): boolean {
  const needle = city.trim().toLowerCase().replace(/\s+/g, '')
  if (!needle) return false
  return placeName.toLowerCase().replace(/\s+/g, '').includes(needle)
}

/** Accept only address-level matches with relevance >= 0.9 in the chosen city. */
export function isAcceptableAddressFeature(
  feature: {
    place_type?: string[]
    relevance?: number
    place_name?: string
  },
  chosenCity: string,
): boolean {
  if (!featureTypesIncludeAddress(feature.place_type)) return false
  if (typeof feature.relevance !== 'number' || feature.relevance < ADDRESS_MIN_RELEVANCE) return false
  if (!cityMentioned(chosenCity, feature.place_name || '')) return false
  return true
}

export function rejectionMessageForFeature(
  feature: { place_type?: string[]; relevance?: number; place_name?: string } | null,
  chosenCity: string,
): string {
  if (
    !feature ||
    !featureTypesIncludeAddress(feature.place_type) ||
    (feature.relevance ?? 0) < ADDRESS_MIN_RELEVANCE
  ) {
    return "We couldn't find that exact address. Check the street number and spelling."
  }
  if (!cityMentioned(chosenCity, feature.place_name || '')) {
    return `That address is not in ${chosenCity.trim() || 'your city'}. Pick a suggestion in the right city.`
  }
  return "We couldn't find that exact address. Check the street number and spelling."
}

export async function suggestAddresses(
  streetQuery: string,
  city: string,
): Promise<{ suggestions: AddressSuggestion[]; tokenMissing: boolean }> {
  const q = streetQuery.trim()
  if (q.length < ADDRESS_MIN_CHARS) return { suggestions: [], tokenMissing: false }

  const params = new URLSearchParams({
    q,
    city: city.trim(),
    autocomplete: 'true',
    limit: String(ADDRESS_MAX_SUGGESTIONS),
  })
  const response = await addressFetch(`${apiBase}/api/geocode?${params.toString()}`, {
    headers: await authHeaders(),
  })
  if (response.status === 503) return { suggestions: [], tokenMissing: true }
  if (response.status === 401 || response.status === 403) {
    return { suggestions: [], tokenMissing: false }
  }
  if (response.status === 429 || !response.ok) return { suggestions: [], tokenMissing: false }
  const body = (await response.json()) as MapboxResponse
  const suggestions: AddressSuggestion[] = []
  for (const feature of body.features ?? []) {
    if (!isAcceptableAddressFeature(feature, city)) continue
    const parsed = parseFeature(feature)
    if (!parsed) continue
    suggestions.push(parsed)
    if (suggestions.length >= ADDRESS_MAX_SUGGESTIONS) break
  }
  return { suggestions, tokenMissing: false }
}

function parseFeature(feature: MapboxFeature): AddressSuggestion | null {
  const center = feature.center
  if (!center || center.length < 2) return null
  const [longitude, latitude] = center
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null
  if (latitude === 0 && longitude === 0) return null

  const placeName = feature.place_name?.trim() || ''
  const house = feature.address?.trim()
  const streetName = feature.text?.trim() || ''
  const street = [house, streetName].filter(Boolean).join(' ').trim() || streetName
  const city =
    contextText(feature.context, 'place') ||
    contextText(feature.context, 'locality') ||
    ''
  const state = contextShortCode(feature.context, 'region') || contextText(feature.context, 'region') || ''
  if (!street || !city || !state) return null

  return {
    id: feature.id || placeName,
    placeName,
    street,
    city,
    state,
    formattedAddress: placeName,
    latitude,
    longitude,
    relevance: feature.relevance ?? 0,
    featureType: feature.place_type?.[0] || 'address',
  }
}

function contextText(context: MapboxContext[] | undefined, kind: string): string {
  const row = context?.find((item) => (item.id || '').startsWith(`${kind}.`))
  return row?.text?.trim() || ''
}

function contextShortCode(context: MapboxContext[] | undefined, kind: string): string {
  const row = context?.find((item) => (item.id || '').startsWith(`${kind}.`))
  const code = row?.short_code?.trim() || ''
  if (code.includes('-')) return code.split('-').pop() || code
  return code
}
