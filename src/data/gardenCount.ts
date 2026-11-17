/** Copy for the neighborhood tally of finished loans and handoffs. */
export function gardenCopy(count: number): { value: string; label: string } {
  const safe = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
  if (safe === 0) return { value: '0', label: 'No exchanges finished yet. The first one starts the tally.' }
  return {
    value: String(safe),
    label: safe === 1 ? 'exchange finished between neighbors' : 'exchanges finished between neighbors',
  }
}
