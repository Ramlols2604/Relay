/** Shapes returned by the FastAPI backend in `backend/app`. */

export type ApiWindow = { start: string | null; end: string | null }

/** Lender windows arrive as `[start, end]` pairs or `{ start, end }` objects. */
export type ApiLenderWindow = [string, string] | { start: string; end: string }

export type ApiResident = {
  id: string
  name: string
  short_name: string | null
  street: string
  initials: string
  x: number
  y: number
}

export type ApiCatalogItem = {
  id: string
  name: string
  category: string
  demo_price_cents: number
  default_loan_hours: number
}

export type ApiNeighbor = {
  inventory_id: string
  resident_id: string
  resident_name: string
  distance: number
  quantity: number
  condition_note: string
  windows: ApiLenderWindow[]
}

export type ApiProjectTool = {
  id: string
  /** Null for a tool Gemini suggested that is not in the catalog. */
  catalog_item_id: string | null
  name: string
  optional: boolean
  have_already: boolean
  neighbors: ApiNeighbor[]
}

export type ApiProject = {
  id: string
  resident_id: string
  raw_text: string
  window: ApiWindow
  tools: ApiProjectTool[]
}

export type ApiToolListCard = {
  type: 'tool_list'
  project_id: string
  raw_text: string
  window: ApiWindow
  snowflake: string
  tools: ApiProjectTool[]
}

export type ApiConfirmationCard = {
  type: 'confirmation'
  request_id: string
  kind: 'need' | 'offer'
  item: { id: string; name: string }
  quantity: number
  area: string | null
  window: ApiWindow
  status: 'pending_confirm'
}

export type ApiAllocation = {
  offer_request_id: string
  resident_id: string
  quantity: number
}

export type ApiMatchCard = {
  type: 'match'
  handoff_id: string
  need_request_id: string
  recipient_id: string
  item: { id: string; name: string }
  quantity: number
  filled_quantity: number
  complete: boolean
  allocations: ApiAllocation[]
  snowflake: string
  status: string
}

export type ApiLoanStatus =
  | 'requested'
  | 'confirmed'
  | 'picked_up'
  | 'returned'
  | 'declined'

export type ApiLoan = {
  loan_id: string
  lender_id: string
  borrower_id: string
  inventory_id: string | null
  catalog_item_id: string
  request_id: string | null
  window: ApiWindow
  status: ApiLoanStatus
  quantity: number
  /** Derived by the API. Missing on older servers. */
  overdue?: boolean
  overdue_minutes?: number | null
  due_soon?: boolean
}

export type ApiHandoffStatus = 'proposed' | 'confirmed' | 'received' | 'declined'

export type ApiHandoff = {
  id: string
  need_request_id: string
  recipient_id: string
  status: ApiHandoffStatus
  recipient_confirmed: boolean
  allocations: (ApiAllocation & { donor_confirmed: boolean })[]
}

export type ApiRequest = {
  id: string
  resident_id: string
  kind: string
  raw_text: string | null
  catalog_item_id: string
  quantity: number
  area: string | null
  window: ApiWindow
  status: string
}

export type ApiLoanStatusCard =
  | ({ type: 'loan_status'; record: 'loan' } & ApiLoan)
  | ({ type: 'loan_status'; record: 'handoff' } & ApiHandoff)
  | { type: 'loan_status'; record: 'request'; request_id: string; status: string }

export type ApiNoMatchCard = {
  type: 'no_match'
  message: string
  request_id?: string
}

export type ApiChatCard =
  | ApiToolListCard
  | ApiConfirmationCard
  | ApiMatchCard
  | ApiLoanStatusCard
  | ApiNoMatchCard

export type ApiActivity = {
  requests: ApiRequest[]
  loans: ApiLoan[]
  handoffs: ApiHandoff[]
}

export type ApiConflict = {
  message: string
  next_free_slot: { start: string; end: string } | null
}

export type ApiInventoryItem = {
  inventory_id?: string
  resident_id: string
  resident_name: string
  catalog_item: string
  catalog_item_id: string | null
  catalog_name: string
  category?: string
  condition?: string
  quantity: number
  willing_to_lend: boolean
  condition_note: string
  x?: number
  y?: number
  distance?: number
  city?: string
}

export type ApiInventory = {
  snowflake: string
  snowflake_message?: string
  items: ApiInventoryItem[]
  resident_id?: string
}

export type ApiGroupBuyMember = { resident_id: string; name: string; initials: string }

export type ApiSharedDemandGroup = {
  catalog_item_id: string
  name: string
  request_count: number
  shared: boolean
  reason: string | null
  schedule: Record<string, { start: string; end: string }> | null
  unschedulable_request_id: string | null
  group_buy_started: boolean
  members: ApiGroupBuyMember[]
  member_share_cents: number | null
  cost: {
    demo_price_cents: number
    households: number
    buy_each_cents: number
    share_one_cents: number
    savings_cents: number
    per_household_buy_cents: number
    per_household_share_cents: number
  } | null
}

export type ApiGroupBuy = {
  catalog_item_id: string
  name: string
  members: ApiGroupBuyMember[]
  member_share_cents: number | null
}

export type ApiSharedDemand = {
  snowflake: string
  groups: ApiSharedDemandGroup[]
  group_buys: ApiGroupBuy[]
}

export type AdminOverview = {
  counts: Record<
    | 'residents'
    | 'shelf_items'
    | 'catalog_items'
    | 'loans'
    | 'overdue_loans'
    | 'requests'
    | 'handoffs'
    | 'group_buys'
    | 'exchanges_finished',
    number
  >
  loans_by_status: Record<string, number>
  requests_by_status: Record<string, number>
  handoffs_by_status: Record<string, number>
  integrations: {
    snowflake: { snowflake: 'ok' | 'error' | 'not_configured'; snowflake_message?: string }
    gemini: boolean
    backboard: boolean
    clerk: boolean
    admins_configured: number
    auth_enforced: boolean
  }
}

export type AdminResident = { id: string; name: string; street: string; city: string; about: string; loans: number }

export type AdminCatalogItem = {
  id: string
  name: string
  category: string
  demo_price_cents: number
  default_loan_hours: number
}

export type AdminAuditEntry = {
  id: string
  at: string
  actor: string
  action: string
  target_type: string
  target_id: string
  detail: Record<string, unknown>
}
