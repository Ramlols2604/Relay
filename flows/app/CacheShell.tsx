import { useEffect, useState } from 'react'
import { api } from '../../src/api/client.ts'
import { CACHE_KEYS, get, setActiveUser } from '../../src/api/cache.ts'
import type { ApiProfile } from '../../src/api/types.ts'

const USER_ID = 'avery'

function readCachedProfile(): ApiProfile | null {
  setActiveUser(USER_ID)
  return get<ApiProfile>(CACHE_KEYS.profile)?.value ?? null
}

/**
 * Mirrors neighborhood-layout first paint: skip "Loading your shelf…" when a cached
 * profile exists, revalidate quietly, and surface the offline notice on failure.
 */
export function CacheShell() {
  const [profile, setProfile] = useState<ApiProfile | null>(() => readCachedProfile())
  const [ready, setReady] = useState(() => Boolean(readCachedProfile()))
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    setActiveUser(USER_ID)
    const hit = get<ApiProfile>(CACHE_KEYS.profile)
    let cancel = false
    api
      .profile(USER_ID)
      .then((saved) => {
        if (cancel) return
        setProfile(saved)
        setOffline(false)
        setReady(true)
      })
      .catch(() => {
        if (cancel) return
        if (hit) {
          setOffline(true)
          setReady(true)
          return
        }
        setReady(true)
      })
    return () => {
      cancel = true
    }
  }, [])

  if (!ready) {
    return (
      <div className="hint" data-testid="shelf-loading">
        <p>Loading your shelf…</p>
      </div>
    )
  }

  return (
    <div data-testid="shelf-ready">
      {offline ? (
        <p className="hint offline-cache-notice" role="status">
          Offline, showing saved info
        </p>
      ) : null}
      <h1>Chat</h1>
      <p data-testid="cached-street">{profile?.street || 'no-street'}</p>
    </div>
  )
}
