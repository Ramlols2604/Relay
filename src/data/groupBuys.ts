import type { ApiGroupBuy, ApiSharedDemand } from '../api/types.ts'

/** Started group buys whose open demand is gone, so they no longer appear in `groups`. */
export function orphanGroupBuys(demand: ApiSharedDemand | null): ApiGroupBuy[] {
  if (!demand) return []
  const open = new Set(demand.groups.map((group) => group.catalog_item_id))
  return (demand.group_buys ?? []).filter((buy) => !open.has(buy.catalog_item_id))
}

export function isMember(members: { resident_id: string }[], resident: string) {
  return members.some((member) => member.resident_id === resident)
}
