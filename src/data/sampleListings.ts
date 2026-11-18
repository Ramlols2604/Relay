/** Shared preference for map/chat demo (sample) listings. */

export const sampleListingsKey = (shelfId: string) =>
  `relay:show-sample-listings:v1:${shelfId || 'anon'}`

/** Explicit user choice, or `null` when the user has never toggled (auto). */
export function readSampleListingsPreference(shelfId: string): boolean | null {
  try {
    const raw = localStorage.getItem(sampleListingsKey(shelfId))
    if (raw === null) return null
    return raw === 'true'
  } catch {
    return null
  }
}

export function writeSampleListingsPreference(shelfId: string, on: boolean): void {
  try {
    localStorage.setItem(sampleListingsKey(shelfId), String(on))
  } catch {
    /* private browsing */
  }
}

/**
 * Demo listings stay on only when the account has no real neighbors in view,
 * unless the user explicitly toggled the preference.
 */
export function resolveSampleListingsOn(
  preference: boolean | null,
  hasRealNeighbors: boolean,
): boolean {
  if (preference !== null) return preference
  return !hasRealNeighbors
}
