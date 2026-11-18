/** Address suggestion acceptance rules + shared /api/geocode autocomplete. */

import { apiBase, authHeaders } from '../api/client.ts'

export const ADDRESS_DEBOUNCE_MS = 400
export const ADDRESS_MIN_CHARS = 4
export const ADDRESS_MAX_SUGGESTIONS = 5
/** Mapbox often scores real streets ~0.85–0.95 when the city is still being typed. */
export const ADDRESS_MIN_RELEVANCE = 0.82

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
  if (!needle) return true
  const hay = placeName.toLowerCase().replace(/\s+/g, '')
  if (hay.includes(needle)) return true
  // Common abbreviations / short forms ("NC" already in place_name; "St." vs "Saint").
  if (needle.length >= 4 && hay.includes(needle.slice(0, 4))) return true
  return false
}

/** Accept address-level matches with enough relevance in (or near) the chosen city. */
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
  if (chosenCity.trim() && !cityMentioned(chosenCity, feature.place_name || '')) return false
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
  if (chosenCity.trim() && !cityMentioned(chosenCity, feature.place_name || '')) {
    return `That address is not in ${chosenCity.trim() || 'your city'}. Pick a suggestion in the right city.`
  }
  return "We couldn't find that exact address. Check the street number and spelling."
}

export type SuggestAddressesResult = {
  suggestions: AddressSuggestion[]
  tokenMissing: boolean
  authRequired: boolean
  rateLimited: boolean
  error: string
}

export async function suggestAddresses(
  streetQuery: string,
  city: string,
): Promise<SuggestAddressesResult> {
  const empty: SuggestAddressesResult = {
    suggestions: [],
    tokenMissing: false,
    authRequired: false,
    rateLimited: false,
    error: '',
  }
  const q = streetQuery.trim()
  if (q.length < ADDRESS_MIN_CHARS) return empty

  const params = new URLSearchParams({
    q,
    city: city.trim(),
    autocomplete: 'true',
    limit: String(ADDRESS_MAX_SUGGESTIONS),
  })
  const response = await addressFetch(`${apiBase}/api/geocode?${params.toString()}`, {
    headers: await authHeaders(),
  })
  if (response.status === 503) {
    return { ...empty, tokenMissing: true, error: 'Mapbox is not configured on the API.' }
  }
  if (response.status === 401 || response.status === 403) {
    return {
      ...empty,
      authRequired: true,
      error: 'Sign in again to look up addresses.',
    }
  }
  if (response.status === 429) {
    return {
      ...empty,
      rateLimited: true,
      error: 'Address lookup limit reached for this hour. Try again shortly.',
    }
  }
  if (!response.ok) {
    return { ...empty, error: "We couldn't look up that address right now. Try again." }
  }
  const body = (await response.json()) as MapboxResponse
  const suggestions: AddressSuggestion[] = []
  for (const feature of body.features ?? []) {
    if (!isAcceptableAddressFeature(feature, city)) continue
    const parsed = parseFeature(feature, city)
    if (!parsed) continue
    suggestions.push(parsed)
    if (suggestions.length >= ADDRESS_MAX_SUGGESTIONS) break
  }
  return {
    ...empty,
    suggestions,
    error:
      suggestions.length === 0
        ? "We couldn't find that exact address. Check the street number and spelling, or pick a close suggestion."
        : '',
  }
}

function parseFeature(feature: MapboxFeature, fallbackCity: string): AddressSuggestion | null {
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
    contextText(feature.context, 'neighborhood') ||
    cityFromPlaceName(placeName) ||
    fallbackCity.trim()
  const state =
    contextShortCode(feature.context, 'region') ||
    contextText(feature.context, 'region') ||
    stateFromPlaceName(placeName)
  if (!street || !city) return null

  return {
    id: feature.id || placeName,
    placeName,
    street,
    city,
    state: state || '',
    formattedAddress: placeName || `${street}, ${city}`,
    latitude,
    longitude,
    relevance: feature.relevance ?? 0,
    featureType: feature.place_type?.[0] || 'address',
  }
}

/** "907 Rebecca Bailey Drive, Charlotte, North Carolina …" → Charlotte */
function cityFromPlaceName(placeName: string): string {
  const parts = placeName.split(',').map((part) => part.trim()).filter(Boolean)
  return parts.length >= 2 ? parts[1]! : ''
}

function stateFromPlaceName(placeName: string): string {
  const parts = placeName.split(',').map((part) => part.trim()).filter(Boolean)
  if (parts.length < 3) return ''
  const region = parts[2]!.replace(/\d+/g, '').trim()
  const known: Record<string, string> = {
    'north carolina': 'NC',
    'south carolina': 'SC',
    virginia: 'VA',
    georgia: 'GA',
    florida: 'FL',
    tennessee: 'TN',
  }
  return known[region.toLowerCase()] || region
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
