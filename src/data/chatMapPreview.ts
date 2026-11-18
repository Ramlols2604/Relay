/** Pure helpers for chat SVG map previews (no network). */

export type ChatMapPoint = {
  id: string
  label: string
  /** Grid x relative to the viewer (viewer is 0,0). */
  x: number
  /** Grid y relative to the viewer. */
  y: number
  kind: 'you' | 'lender'
  /** 1-based rank shown on the pin (nearest lenders list). Omitted for 'you'. */
  number?: number
}

/** Stable angle from an id so the same neighbor always lands in the same place. */
export function angleForId(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0
  }
  return (hash % 360) * (Math.PI / 180)
}

/** Build lender points from chat match distances (Manhattan blocks → polar layout). */
export function pointsFromDistances(
  lenders: readonly { id: string; label: string; distance: number }[],
  options?: { numbered?: boolean },
): ChatMapPoint[] {
  const you: ChatMapPoint = { id: 'you', label: 'You', x: 0, y: 0, kind: 'you' }
  const others = lenders.map((lender, index) => {
    const radius = Math.max(0.5, Number(lender.distance) || 1)
    const angle = angleForId(lender.id)
    return {
      id: lender.id,
      label: lender.label,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      kind: 'lender' as const,
      ...(options?.numbered ? { number: index + 1 } : {}),
    }
  })
  return [you, ...others]
}
