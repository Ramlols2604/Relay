import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clampRadiusMiles,
  DEFAULT_RADIUS_MILES,
  haversineMiles,
  nextWiderRadius,
  RADIUS_STEPS,
  RADIUS_WIDEN_THRESHOLD,
  radiusLabel,
  readStoredRadius,
  writeStoredRadius,
} from './searchRadius.ts'

test('radius steps and labels', () => {
  assert.deepEqual([...RADIUS_STEPS], [1, 2, 5, 10, 25, 50])
  assert.equal(DEFAULT_RADIUS_MILES, 2)
  assert.equal(radiusLabel(2), 'Within 2 miles')
  assert.equal(radiusLabel(1), 'Within 1 mile')
  assert.equal(clampRadiusMiles(3), 2)
  assert.equal(clampRadiusMiles(40), 50)
  assert.equal(nextWiderRadius(2), 5)
  assert.equal(nextWiderRadius(50), null)
})

test('haversine matches known distances', () => {
  const oneDeg = haversineMiles(35, -78, 36, -78)
  assert.ok(oneDeg > 68.5 && oneDeg < 69.8)
  assert.equal(haversineMiles(35.7915, -78.7811, 35.7915, -78.7811), 0)
  const caryToRaleigh = haversineMiles(35.7915, -78.7811, 35.7796, -78.6382)
  assert.ok(caryToRaleigh > 7.5 && caryToRaleigh < 9)
})

test('widen prompt threshold and localStorage round-trip', () => {
  assert.equal(RADIUS_WIDEN_THRESHOLD, 5)
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
    assert.equal(readStoredRadius('user_a'), 2)
    writeStoredRadius('user_a', 10)
    assert.equal(readStoredRadius('user_a'), 10)
    assert.equal(readStoredRadius('user_b'), 2)
    // Widen copy used in the Map UI when count < threshold.
    const count = 3
    const miles = 2
    const next = nextWiderRadius(miles)
    assert.ok(count < RADIUS_WIDEN_THRESHOLD && next === 5)
    assert.equal(
      `Only ${count} listings within ${miles} miles. Widen the search?`,
      'Only 3 listings within 2 miles. Widen the search?',
    )
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: original })
  }
})
