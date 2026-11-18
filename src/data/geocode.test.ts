import assert from 'node:assert/strict'
import test from 'node:test'
import { setAuthTokenProvider } from '../api/client.ts'
import {
  addressQuery,
  cacheKeyForAddress,
  geocodeAddress,
  setGeocodeFetchForTests,
  writeCachedCenter,
} from './geocode.ts'

test('addressQuery joins street and city', () => {
  assert.equal(addressQuery('100 Main St', 'Cary'), '100 Main St, Cary, United States')
  assert.equal(addressQuery('', 'Cary'), 'Cary, United States')
  assert.equal(addressQuery('  ', '  '), '')
})

test('cache keys are stable for the same address', () => {
  assert.equal(cacheKeyForAddress('100 Main', 'Cary'), cacheKeyForAddress('100 Main', 'Cary'))
  assert.match(cacheKeyForAddress('100 Main', 'Cary'), /relay:geocode:v4:100 main, cary, united states/)
})

test('geocodeAddress returns null without an address', async () => {
  assert.equal(await geocodeAddress('', '', 'token'), null)
})

test('geocodeAddress uses localStorage then the shared /api/geocode endpoint', async () => {
  const store = new Map<string, string>()
  const original = globalThis.localStorage
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value)
      },
    },
  })
  try {
    let called = 0
    setAuthTokenProvider(async () => 'geocode-session')
    setGeocodeFetchForTests(async (input, init) => {
      called += 1
      const url = String(input)
      assert.match(url, /\/api\/geocode\?/)
      assert.match(url, /q=/)
      const headers = new Headers(init?.headers)
      assert.equal(headers.get('Authorization'), 'Bearer geocode-session')
      return new Response(
        JSON.stringify({
          longitude: -78.78,
          latitude: 35.79,
          label: 'Cary, North Carolina, United States',
          cache_hit: false,
        }),
        { status: 200 },
      )
    })
    const first = await geocodeAddress('14 Willow Court', 'Cary')
    assert.deepEqual(first, {
      longitude: -78.78,
      latitude: 35.79,
      label: 'Cary, North Carolina, United States',
    })
    assert.equal(called, 1)

    const second = await geocodeAddress('14 Willow Court', 'Cary')
    assert.equal(called, 1)
    assert.deepEqual(second, first)

    writeCachedCenter('Other', 'Town', { longitude: 1, latitude: 2, label: 'Other' })
    assert.equal((await geocodeAddress('Other', 'Town'))?.longitude, 1)
  } finally {
    setGeocodeFetchForTests(null)
    setAuthTokenProvider(async () => null)
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: original })
  }
})
