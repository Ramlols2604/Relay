/** Fictional Willow Court resident used across Chat, My Inventory, and the shell. */
export const demoResident = {
  name: 'Avery Moss',
  shortName: 'Avery',
  street: '14 Willow Court',
  initials: 'AM',
}

export const demoCommunityLabel = 'Willow Court · fictional demo community'

/**
 * Top-bar place line. Signed-in accounts get "street · city" (or just city if street is
 * missing). Demo / unsigned browsing always gets the Willow Court demo label.
 */
export function placeLabel(street: string, city: string, signedIn: boolean): string {
  if (!signedIn) return demoCommunityLabel
  return [street.trim(), city.trim()].filter(Boolean).join(' · ')
}
