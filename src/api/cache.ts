/** In-memory + localStorage cache with per-user keys and TTL. */

export type CacheHit<T> = {
  value: T
  /** False when the TTL has elapsed (still returned for stale-while-revalidate). */
  fresh: boolean
  etag?: string
}

type CacheEntry = {
  value: unknown
  savedAt: number
  ttlMs: number
  etag?: string
}

const PREFIX = 'relay:v1:'
const memory = new Map<string, CacheEntry>()
let activeUserId: string | null = null

const listeners = new Map<string, Set<(value: unknown) => void>>()

export function cacheStorageKey(key: string, userId: string | null = activeUserId): string {
  return `${PREFIX}${userId ?? 'anon'}:${key}`
}

/**
 * Switch the signed-in user. Clears cached data when leaving a previous user
 * (switch or sign-out). A cold start (null → user) keeps that user's localStorage
 * so a refresh can hydrate immediately.
 */
export function setActiveUser(userId: string | null): void {
  if (activeUserId === userId) return
  if (activeUserId !== null) {
    clearAll()
  }
  activeUserId = userId
}

export function getActiveUser(): string | null {
  return activeUserId
}

export function get<T>(key: string): CacheHit<T> | null {
  const storageKey = cacheStorageKey(key)
  let entry = memory.get(storageKey) ?? null
  if (!entry) {
    entry = readStorage(storageKey)
    if (entry) memory.set(storageKey, entry)
  }
  if (!entry) return null
  const fresh = Date.now() - entry.savedAt < entry.ttlMs
  return {
    value: entry.value as T,
    fresh,
    etag: entry.etag,
  }
}

export function set(key: string, value: unknown, ttlMs: number, etag?: string): void {
  const storageKey = cacheStorageKey(key)
  const entry: CacheEntry = {
    value,
    savedAt: Date.now(),
    ttlMs,
    etag,
  }
  memory.set(storageKey, entry)
  writeStorage(storageKey, entry)
  const subs = listeners.get(key)
  if (subs) {
    for (const fn of subs) fn(value)
  }
}

export function invalidate(key: string): void {
  const storageKey = cacheStorageKey(key)
  memory.delete(storageKey)
  removeStorage(storageKey)
}

export function invalidateMany(keys: readonly string[]): void {
  for (const key of keys) invalidate(key)
}

export function clearAll(): void {
  memory.clear()
  try {
    const store = localStorage
    const doomed: string[] = []
    for (let i = 0; i < store.length; i++) {
      const name = store.key(i)
      if (name && name.startsWith(PREFIX)) doomed.push(name)
    }
    for (const name of doomed) store.removeItem(name)
  } catch {
    /* private browsing / disabled storage */
  }
}

export function subscribe(key: string, fn: (value: unknown) => void): () => void {
  let set = listeners.get(key)
  if (!set) {
    set = new Set()
    listeners.set(key, set)
  }
  set.add(fn)
  return () => {
    set!.delete(fn)
    if (set!.size === 0) listeners.delete(key)
  }
}

/** Test helper: drop memory + listeners without touching user id. */
export function resetCacheForTests(): void {
  memory.clear()
  listeners.clear()
  activeUserId = null
  try {
    const store = localStorage
    const doomed: string[] = []
    for (let i = 0; i < store.length; i++) {
      const name = store.key(i)
      if (name && name.startsWith(PREFIX)) doomed.push(name)
    }
    for (const name of doomed) store.removeItem(name)
  } catch {
    /* ignore */
  }
}

function readStorage(storageKey: string): CacheEntry | null {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CacheEntry
    if (
      !parsed ||
      typeof parsed.savedAt !== 'number' ||
      typeof parsed.ttlMs !== 'number' ||
      !('value' in parsed)
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function writeStorage(storageKey: string, entry: CacheEntry): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(entry))
  } catch {
    /* quota / private browsing */
  }
}

function removeStorage(storageKey: string): void {
  try {
    localStorage.removeItem(storageKey)
  } catch {
    /* ignore */
  }
}

export const TTL = {
  profile: 5 * 60 * 1000,
  catalog: 60 * 60 * 1000,
  residents: 5 * 60 * 1000,
  inventory: 60 * 1000,
} as const

export const CACHE_KEYS = {
  profile: 'profile',
  catalog: 'catalog',
  residents: 'residents',
  inventory: 'inventory',
} as const
