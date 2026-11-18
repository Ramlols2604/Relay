/** Compare cities without caring about case or extra spaces. */
export function normalizeCityKey(city: string): string {
  return city.trim().replace(/\s+/g, '').toLowerCase()
}

export function sameCity(left: string, right: string): boolean {
  const a = normalizeCityKey(left)
  const b = normalizeCityKey(right)
  if (!a || !b) return false
  return a === b
}
