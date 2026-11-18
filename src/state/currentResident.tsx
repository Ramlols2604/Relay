import { useUser } from '@clerk/react-router'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../api/client.ts'
import { CACHE_KEYS, get, setActiveUser } from '../api/cache.ts'
import type { ApiProfile } from '../api/types.ts'
import {
  CurrentResidentContext,
  emptyResident,
  type CurrentResident,
} from './currentResidentStore.ts'

type ProfileFields = {
  street: string
  city: string
  about: string
  onboarded: boolean
  addressVerified: boolean
  formattedAddress: string
  state: string
  latitude: number | null
  longitude: number | null
}

function fieldsFromProfile(saved: ApiProfile): ProfileFields {
  return {
    street: saved.street ?? '',
    city: saved.city ?? '',
    about: saved.about ?? '',
    onboarded: Boolean(saved.onboarded),
    addressVerified: Boolean(saved.address_verified),
    formattedAddress: saved.formatted_address ?? '',
    state: saved.state ?? '',
    latitude: typeof saved.latitude === 'number' ? saved.latitude : null,
    longitude: typeof saved.longitude === 'number' ? saved.longitude : null,
  }
}

const emptyFields: ProfileFields = {
  street: '',
  city: '',
  about: '',
  onboarded: false,
  addressVerified: false,
  formattedAddress: '',
  state: '',
  latitude: null,
  longitude: null,
}

function readCachedProfile(userId: string): ProfileFields | null {
  setActiveUser(userId)
  const hit = get<ApiProfile>(CACHE_KEYS.profile)
  return hit ? fieldsFromProfile(hit.value) : null
}

export function CurrentResidentProvider({ children }: { children: ReactNode }) {
  const { isLoaded, user } = useUser()
  const userId = user?.id ?? null
  const [fields, setFields] = useState<ProfileFields>(emptyFields)
  const [profileReady, setProfileReady] = useState(false)
  const [offlineCached, setOfflineCached] = useState(false)
  const [hydrateKey, setHydrateKey] = useState<string | null>(null)

  // Sync-hydrate from cache as soon as Clerk gives us a user id (before paint).
  const nextKey = isLoaded ? userId : 'loading'
  if (nextKey !== hydrateKey) {
    setHydrateKey(nextKey)
    if (!isLoaded) {
      setFields(emptyFields)
      setProfileReady(false)
      setOfflineCached(false)
    } else if (!userId) {
      setActiveUser(null)
      setFields(emptyFields)
      setProfileReady(true)
      setOfflineCached(false)
    } else {
      const cached = readCachedProfile(userId)
      if (cached) {
        setFields(cached)
        setProfileReady(true)
      } else {
        setFields(emptyFields)
        setProfileReady(false)
      }
      setOfflineCached(false)
    }
  }

  const applyFields = useCallback((next: ProfileFields) => {
    setFields(next)
  }, [])

  const refreshProfile = useCallback(async () => {
    if (!userId) {
      setActiveUser(null)
      applyFields(emptyFields)
      setOfflineCached(false)
      setProfileReady(true)
      return
    }
    setActiveUser(userId)
    const hadCache = Boolean(get<ApiProfile>(CACHE_KEYS.profile))
    try {
      const saved = await api.profile(userId)
      applyFields(fieldsFromProfile(saved))
      setOfflineCached(false)
      setProfileReady(true)
    } catch {
      if (hadCache) {
        setOfflineCached(true)
        setProfileReady(true)
        return
      }
      applyFields(emptyFields)
      setOfflineCached(false)
      setProfileReady(true)
    }
  }, [applyFields, userId])

  useEffect(() => {
    if (!isLoaded) return
    void refreshProfile()
  }, [isLoaded, refreshProfile])

  const value = useMemo((): CurrentResident => {
    if (!isLoaded) {
      return { ...emptyResident, profileReady: false, offlineCached: false, refreshProfile }
    }
    if (!user) {
      return { ...emptyResident, profileReady: true, offlineCached: false, refreshProfile }
    }

    const email = user.primaryEmailAddress?.emailAddress
    const name = user.fullName?.trim() || user.username || email?.split('@')[0] || 'Neighbor'
    const words = name.split(/\s+/).filter(Boolean)
    const initials =
      words.length > 1
        ? `${words[0]![0]}${words[words.length - 1]![0]}`
        : (words[0]?.slice(0, 2) ?? 'YO')

    return {
      id: user.id,
      name,
      shortName: user.firstName?.trim() || words[0] || name,
      initials: initials.toUpperCase(),
      street: fields.street,
      city: fields.city,
      about: fields.about,
      email: email ?? '',
      imageUrl: user.hasImage ? user.imageUrl : undefined,
      onboarded: fields.onboarded,
      addressVerified: fields.addressVerified,
      formattedAddress: fields.formattedAddress,
      state: fields.state,
      latitude: fields.latitude,
      longitude: fields.longitude,
      profileReady,
      offlineCached,
      refreshProfile,
    }
  }, [fields, isLoaded, offlineCached, profileReady, refreshProfile, user])

  return <CurrentResidentContext.Provider value={value}>{children}</CurrentResidentContext.Provider>
}
