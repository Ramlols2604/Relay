import assert from 'node:assert/strict'
import test from 'node:test'
import { setAuthTokenProvider } from '../api/client.ts'
import {
  ADDRESS_MAX_SUGGESTIONS,
  ADDRESS_MIN_RELEVANCE,
  isAcceptableAddressFeature,
  isDemoStreetAddress,
  rejectionMessageForFeature,
  setAddressFetchForTests,
  suggestAddresses,
} from './addressVerify.ts'

test('demo street detection', () => {
  assert.equal(isDemoStreetAddress('14 Willow Court'), true)
  assert.equal(isDemoStreetAddress('  14   willow COURT '), true)
  assert.equal(isDemoStreetAddress('100 Main Street'), false)
})

test('accepts address features with relevance >= 0.82 in the chosen city', () => {
  const good = {
    place_type: ['address'],
    relevance: 0.95,
    place_name: '100 Main Street, Cary, North Carolina, United States',
  }
  assert.equal(isAcceptableAddressFeature(good, 'Cary'), true)
  assert.equal(isAcceptableAddressFeature(good, 'cary'), true)
  assert.equal(
    isAcceptableAddressFeature({ ...good, relevance: 0.84 }, 'Cary'),
    true,
  )

  assert.equal(
    isAcceptableAddressFeature({ ...good, place_type: ['place'] }, 'Cary'),
    false,
  )
  assert.equal(
    isAcceptableAddressFeature({ ...good, relevance: 0.7 }, 'Cary'),
    false,
  )
  assert.equal(
    isAcceptableAddressFeature({ ...good, place_name: '100 Main Street, Durham, NC' }, 'Cary'),
    false,
  )
  assert.equal(ADDRESS_MIN_RELEVANCE, 0.82)
})

test('rejection message for approximate matches', () => {
  assert.match(
    rejectionMessageForFeature({ place_type: ['place'], relevance: 0.99, place_name: 'Cary, NC' }, 'Cary'),
    /couldn't find that exact address/i,
  )
  assert.match(
    rejectionMessageForFeature(
      {
        place_type: ['address'],
        relevance: 0.95,
        place_name: '100 Main Street, Durham, NC',
      },
      'Cary',
    ),
    /not in Cary/i,
  )
})

test('suggestAddresses uses /api/geocode autocomplete and caps at five', async () => {
  const features = Array.from({ length: 8 }, (_, index) => ({
    id: `address.${index}`,
    place_type: ['address'],
    relevance: 0.99,
    place_name: `${100 + index} Main Street, Cary, North Carolina, United States`,
    text: 'Main Street',
    address: String(100 + index),
    center: [-78.78 - index * 0.001, 35.79] as [number, number],
    context: [
      { id: 'place.1', text: 'Cary' },
      { id: 'region.1', text: 'North Carolina', short_code: 'US-NC' },
    ],
  }))
  features.push({
    id: 'place.approx',
    place_type: ['place'],
    relevance: 1,
    place_name: 'Cary, North Carolina, United States',
    text: 'Cary',
    address: '',
    center: [-78.78, 35.79],
    context: [],
  })

  setAuthTokenProvider(async () => 'test-session-token')
  setAddressFetchForTests(async (input, init) => {
    assert.match(String(input), /\/api\/geocode\?/)
    assert.match(String(input), /autocomplete=true/)
    const headers = new Headers(init?.headers)
    assert.equal(headers.get('Authorization'), 'Bearer test-session-token')
    return new Response(JSON.stringify({ features }), { status: 200 })
  })
  try {
    const { suggestions, tokenMissing } = await suggestAddresses('100 Main', 'Cary')
    assert.equal(tokenMissing, false)
    assert.equal(suggestions.length, ADDRESS_MAX_SUGGESTIONS)
    assert.ok(suggestions.every((row) => row.featureType === 'address'))
    assert.ok(suggestions.every((row) => row.relevance >= ADDRESS_MIN_RELEVANCE))
    assert.ok(suggestions.every((row) => row.city === 'Cary'))
  } finally {
    setAddressFetchForTests(null)
    setAuthTokenProvider(async () => null)
  }
})

test('suggestAddresses reports missing Mapbox on the API', async () => {
  setAddressFetchForTests(async () => new Response(JSON.stringify({ detail: 'missing' }), { status: 503 }))
  try {
    const result = await suggestAddresses('100 Main', 'Cary')
    assert.equal(result.tokenMissing, true)
    assert.equal(result.suggestions.length, 0)
    assert.equal(result.authRequired, false)
  } finally {
    setAddressFetchForTests(null)
  }
})

test('suggestAddresses sends Clerk auth so /api/geocode is not 401', async () => {
  setAuthTokenProvider(async () => 'clerk-jwt')
  let sawAuth = false
  setAddressFetchForTests(async (_input, init) => {
    const headers = new Headers(init?.headers)
    sawAuth = headers.get('Authorization') === 'Bearer clerk-jwt'
    return new Response(JSON.stringify({ detail: 'Unauthorized' }), { status: 401 })
  })
  try {
    const result = await suggestAddresses('5110 Red Alder Ln', 'Charlotte')
    assert.equal(sawAuth, true)
    assert.equal(result.tokenMissing, false)
    assert.equal(result.authRequired, true)
    assert.equal(result.suggestions.length, 0)
    assert.match(result.error, /sign in again/i)
  } finally {
    setAddressFetchForTests(null)
    setAuthTokenProvider(async () => null)
  }
})
