import assert from 'node:assert/strict'
import test, { afterEach, beforeEach } from 'node:test'

class MemoryStorage {
  #map = new Map<string, string>()
  get length() {
    return this.#map.size
  }
  clear() {
    this.#map.clear()
  }
  getItem(key: string) {
    return this.#map.has(key) ? this.#map.get(key)! : null
  }
  key(index: number) {
    return [...this.#map.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.#map.delete(key)
  }
  setItem(key: string, value: string) {
    this.#map.set(key, String(value))
  }
}

const memory = new MemoryStorage()
Object.defineProperty(globalThis, 'localStorage', {
  value: memory,
  configurable: true,
  writable: true,
})

const {
  CACHE_KEYS,
  TTL,
  cacheStorageKey,
  clearAll,
  get,
  invalidate,
  resetCacheForTests,
  set,
  setActiveUser,
} = await import('./cache.ts')

beforeEach(() => {
  memory.clear()
  resetCacheForTests()
})

afterEach(() => {
  memory.clear()
  resetCacheForTests()
})

test('get returns null when empty', () => {
  setActiveUser('user-a')
  assert.equal(get('profile'), null)
})

test('set then get returns the value as fresh within TTL', () => {
  setActiveUser('user-a')
  set(CACHE_KEYS.profile, { city: 'Cary' }, TTL.profile)
  const hit = get<{ city: string }>(CACHE_KEYS.profile)
  assert.ok(hit)
  assert.equal(hit.fresh, true)
  assert.equal(hit.value.city, 'Cary')
})

test('TTL expiry marks the hit stale but still returns the value', () => {
  setActiveUser('user-a')
  const realNow = Date.now
  let now = 1_000_000
  Date.now = () => now
  try {
    set(CACHE_KEYS.inventory, { items: [1] }, 1_000)
    assert.equal(get(CACHE_KEYS.inventory)?.fresh, true)
    now += 1_001
    const hit = get<{ items: number[] }>(CACHE_KEYS.inventory)
    assert.ok(hit)
    assert.equal(hit.fresh, false)
    assert.deepEqual(hit.value.items, [1])
  } finally {
    Date.now = realNow
  }
})

test('keys are scoped to the signed-in user', () => {
  setActiveUser('user-a')
  set(CACHE_KEYS.profile, { id: 'a' }, TTL.profile)
  assert.equal(cacheStorageKey(CACHE_KEYS.profile), 'relay:v1:user-a:profile')
  setActiveUser('user-b')
  assert.equal(get(CACHE_KEYS.profile), null)
  set(CACHE_KEYS.profile, { id: 'b' }, TTL.profile)
  assert.equal(get<{ id: string }>(CACHE_KEYS.profile)?.value.id, 'b')
})

test('switching users clears all cached data', () => {
  setActiveUser('user-a')
  set(CACHE_KEYS.profile, { id: 'a' }, TTL.profile)
  set(CACHE_KEYS.catalog, [{ id: 'drill' }], TTL.catalog)
  assert.ok(memory.length >= 1)
  setActiveUser('user-b')
  assert.equal(get(CACHE_KEYS.profile), null)
  assert.equal(get(CACHE_KEYS.catalog), null)
  assert.equal(memory.length, 0)
})

test('sign-out clears everything', () => {
  setActiveUser('user-a')
  set(CACHE_KEYS.residents, [{ id: 'avery' }], TTL.residents)
  setActiveUser(null)
  assert.equal(get(CACHE_KEYS.residents), null)
  assert.equal(memory.length, 0)
})

test('cold start keeps the previous user localStorage so a refresh can hydrate', () => {
  setActiveUser('user-a')
  set(CACHE_KEYS.profile, { city: 'Cary' }, TTL.profile)
  const raw = memory.getItem('relay:v1:user-a:profile')
  assert.ok(raw)
  // Simulate a full page reload: module memory is gone, localStorage remains.
  resetCacheForTests()
  memory.setItem('relay:v1:user-a:profile', raw)
  setActiveUser('user-a')
  assert.equal(get<{ city: string }>(CACHE_KEYS.profile)?.value.city, 'Cary')
})

test('invalidate removes one key', () => {
  setActiveUser('user-a')
  set(CACHE_KEYS.profile, { id: 'a' }, TTL.profile)
  set(CACHE_KEYS.inventory, { items: [] }, TTL.inventory)
  invalidate(CACHE_KEYS.inventory)
  assert.ok(get(CACHE_KEYS.profile))
  assert.equal(get(CACHE_KEYS.inventory), null)
})

test('clearAll wipes memory and localStorage', () => {
  setActiveUser('user-a')
  set(CACHE_KEYS.catalog, [], TTL.catalog)
  clearAll()
  assert.equal(get(CACHE_KEYS.catalog), null)
  assert.equal(memory.length, 0)
})

test('localStorage setItem throwing still keeps the in-memory value', () => {
  setActiveUser('user-a')
  const original = memory.setItem.bind(memory)
  memory.setItem = () => {
    throw new Error('quota')
  }
  try {
    set(CACHE_KEYS.profile, { ok: true }, TTL.profile)
    assert.equal(get<{ ok: boolean }>(CACHE_KEYS.profile)?.value.ok, true)
  } finally {
    memory.setItem = original
  }
})

test('localStorage getItem throwing falls back to miss then memory', () => {
  setActiveUser('user-a')
  set(CACHE_KEYS.profile, { ok: true }, TTL.profile)
  const original = memory.getItem.bind(memory)
  memory.getItem = () => {
    throw new Error('blocked')
  }
  try {
    // Memory still has it.
    assert.equal(get<{ ok: boolean }>(CACHE_KEYS.profile)?.value.ok, true)
  } finally {
    memory.getItem = original
  }
})

test('mirrors values into localStorage under the versioned prefix', () => {
  setActiveUser('user-a')
  set(CACHE_KEYS.profile, { city: 'Cary' }, TTL.profile, '"etag-1"')
  const raw = memory.getItem('relay:v1:user-a:profile')
  assert.ok(raw)
  const parsed = JSON.parse(raw) as { value: { city: string }; etag?: string; ttlMs: number }
  assert.equal(parsed.value.city, 'Cary')
  assert.equal(parsed.etag, '"etag-1"')
  assert.equal(parsed.ttlMs, TTL.profile)
})
