import { createContext, useContext } from 'react'

export type CurrentResident = {
  id: string | null
  name: string
  shortName: string
  initials: string
  street: string
  city: string
  about: string
  email: string
  imageUrl?: string
  onboarded: boolean
  addressVerified: boolean
  formattedAddress: string
  state: string
  latitude: number | null
  longitude: number | null
  profileReady: boolean
  /** True when we are showing a cached profile because revalidation failed. */
  offlineCached: boolean
  refreshProfile: () => Promise<void>
}

export const emptyResident: CurrentResident = {
  id: null,
  name: '',
  shortName: '',
  initials: '',
  street: '',
  city: '',
  about: '',
  email: '',
  onboarded: false,
  addressVerified: false,
  formattedAddress: '',
  state: '',
  latitude: null,
  longitude: null,
  profileReady: false,
  offlineCached: false,
  refreshProfile: async () => undefined,
}

export const CurrentResidentContext = createContext<CurrentResident>(emptyResident)

export function useCurrentResident(): CurrentResident {
  return useContext(CurrentResidentContext)
}
