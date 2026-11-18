import type {
  AdminAuditEntry,
  AdminCatalogItem,
  AdminOverview,
  AdminResident,
  ApiActivity,
  ApiCatalogItem,
  ApiGroupBuy,
  ApiRequest,
  ApiChatCard,
  ApiHandoff,
  ApiInventory,
  ApiInventoryItem,
  ApiLoan,
  ApiProject,
  ApiProfile,
  ApiResident,
  ApiGroupBuyMember,
  ApiSampleListing,
  ApiSharedDemand,
} from './types.ts'
import { CACHE_KEYS, TTL, get, getActiveUser, invalidate, set, setActiveUser } from './cache.ts'

const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env
export const apiBase = (viteEnv?.VITE_API_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '')

let tokenProvider: () => Promise<string | null> = async () => null

/** Clerk session token. The app sets this after sign-in. Do not paste a token by hand. */
export function setAuthTokenProvider(provider: () => Promise<string | null>) {
  tokenProvider = provider
}

/** Authorization header for fetches outside `request()` (e.g. /api/geocode). */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await tokenProvider()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export class ApiError extends Error {
  status: number
  detail: unknown

  constructor(status: number, detail: unknown) {
    super(errorMessage(status, detail))
    this.status = status
    this.detail = detail
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await tokenProvider()
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  })
  if (response.status === 304) {
    throw new ApiError(304, 'Not modified')
  }
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = body && typeof body === 'object' && 'detail' in body ? body.detail : body
    throw new ApiError(response.status, detail)
  }
  return body as T
}

type EtagResult<T> = {
  value: T
  etag?: string
  notModified: boolean
}

async function requestWithEtag<T>(path: string, etag?: string): Promise<EtagResult<T>> {
  const token = await tokenProvider()
  const response = await fetch(`${apiBase}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(etag ? { 'If-None-Match': etag } : {}),
    },
  })
  const nextEtag = response.headers.get('ETag') ?? etag
  if (response.status === 304) {
    return { value: undefined as unknown as T, etag: nextEtag, notModified: true }
  }
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = body && typeof body === 'object' && 'detail' in body ? body.detail : body
    throw new ApiError(response.status, detail)
  }
  return { value: body as T, etag: nextEtag ?? undefined, notModified: false }
}

function post<T>(path: string, body?: unknown) {
  return request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
}

/**
 * Stale-while-revalidate: return a cached copy immediately (even if expired), refresh in the
 * background, and fall back to cache when the network fails.
 */
async function swrGet<T>(
  key: string,
  ttlMs: number,
  load: (etag?: string) => Promise<EtagResult<T>>,
): Promise<T> {
  const hit = get<T>(key)
  if (hit) {
    void (async () => {
      try {
        const result = await load(hit.etag)
        if (result.notModified) {
          set(key, hit.value, ttlMs, hit.etag)
          return
        }
        set(key, result.value, ttlMs, result.etag)
      } catch {
        /* keep stale */
      }
    })()
    return hit.value
  }
  const result = await load(undefined)
  if (result.notModified) {
    throw new ApiError(304, 'Not modified')
  }
  set(key, result.value, ttlMs, result.etag)
  return result.value
}

type LoanCard = { type: 'loan_status'; record: 'loan' } & ApiLoan
type HandoffCard = { type: 'loan_status'; record: 'handoff' } & ApiHandoff

export const api = {
  chat: (
    residentId: string,
    message: string,
    opts?: { includeDemoListings?: boolean; radiusMiles?: number },
  ) =>
    post<ApiChatCard>('/api/chat', {
      resident_id: residentId,
      message,
      ...(opts?.includeDemoListings !== undefined ? { include_demo_listings: opts.includeDemoListings } : {}),
      ...(opts?.radiusMiles !== undefined ? { radius_miles: opts.radiusMiles } : {}),
    }),
  confirmRequest: (residentId: string, requestId: string) =>
    post<ApiChatCard>(`/api/requests/${requestId}/confirm`, { resident_id: residentId }),
  residents: () =>
    swrGet<ApiResident[]>(CACHE_KEYS.residents, TTL.residents, (etag) =>
      requestWithEtag<ApiResident[]>('/api/residents', etag),
    ),
  saveProfile: async (body: {
    clerk_user_id: string
    name: string
    email: string
    initials: string
    street: string
    city: string
    about?: string
    latitude?: number | null
    longitude?: number | null
    formatted_address?: string | null
    state?: string | null
  }) => {
    setActiveUser(body.clerk_user_id)
    const saved = await post<ApiProfile>('/api/me', body)
    set(CACHE_KEYS.profile, saved, TTL.profile)
    invalidate(CACHE_KEYS.residents)
    return saved
  },
  profile: async (clerkUserId: string) => {
    setActiveUser(clerkUserId)
    // Always revalidate; callers with a cached copy handle network failure themselves.
    const saved = await request<ApiProfile>(
      `/api/me?clerk_user_id=${encodeURIComponent(clerkUserId)}`,
    )
    set(CACHE_KEYS.profile, saved, TTL.profile)
    return saved
  },
  updateProfile: async (body: {
    clerk_user_id: string
    street?: string
    city?: string
    about?: string
    latitude?: number | null
    longitude?: number | null
    formatted_address?: string | null
    state?: string | null
  }) => {
    setActiveUser(body.clerk_user_id)
    const saved = await request<ApiProfile>('/api/me', {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
    set(CACHE_KEYS.profile, saved, TTL.profile)
    invalidate(CACHE_KEYS.residents)
    return saved
  },
  inventory: (residentId: string) => {
    const self = getActiveUser()
    if (self && residentId === self) {
      return swrGet<ApiInventory>(CACHE_KEYS.inventory, TTL.inventory, async () => ({
        value: await request<ApiInventory>(
          `/api/inventory?resident_id=${encodeURIComponent(residentId)}`,
        ),
        notModified: false,
      }))
    }
    return request<ApiInventory>(`/api/inventory?resident_id=${encodeURIComponent(residentId)}`)
  },
  createInventory: async (
    residentId: string,
    body: { name: string; category: string; quantity: number; condition: string; notes: string; available_to_lend: boolean },
  ) => {
    const saved = await post<ApiInventoryItem>('/api/inventory', { resident_id: residentId, ...body })
    invalidate(CACHE_KEYS.inventory)
    return saved
  },
  updateInventory: async (
    residentId: string,
    itemId: string,
    body: { name: string; category: string; quantity: number; condition: string; notes: string; available_to_lend: boolean },
  ) => {
    const saved = await request<ApiInventoryItem>(`/api/inventory/${encodeURIComponent(itemId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ resident_id: residentId, ...body }),
    })
    invalidate(CACHE_KEYS.inventory)
    return saved
  },
  deleteInventory: async (residentId: string, itemId: string) => {
    const saved = await request<{ deleted: string }>(
      `/api/inventory/${encodeURIComponent(itemId)}?resident_id=${encodeURIComponent(residentId)}`,
      { method: 'DELETE' },
    )
    invalidate(CACHE_KEYS.inventory)
    return saved
  },
  neighborhood: (residentId: string) =>
    request<ApiInventory>(`/api/neighborhood?resident_id=${encodeURIComponent(residentId)}`),
  listings: (
    query:
      | { bbox: { west: number; south: number; east: number; north: number } }
      | { radiusMiles: number; latitude: number; longitude: number },
    limit = 2000,
  ) => {
    if ('bbox' in query) {
      const box = `${query.bbox.west},${query.bbox.south},${query.bbox.east},${query.bbox.north}`
      return request<{ items: ApiSampleListing[]; count: number; is_sample: true }>(
        `/api/listings?bbox=${encodeURIComponent(box)}&limit=${limit}`,
      )
    }
    const params = new URLSearchParams({
      radius_miles: String(query.radiusMiles),
      lat: String(query.latitude),
      lng: String(query.longitude),
      limit: String(limit),
    })
    return request<{
      items: ApiSampleListing[]
      count: number
      is_sample: true
      radius_miles: number
    }>(`/api/listings?${params.toString()}`)
  },
  catalog: () =>
    swrGet<ApiCatalogItem[]>(CACHE_KEYS.catalog, TTL.catalog, (etag) =>
      requestWithEtag<ApiCatalogItem[]>('/api/catalog', etag),
    ),
  activity: () => request<ApiActivity>('/api/activity'),
  sharedDemand: () => request<ApiSharedDemand>('/api/shared-demand'),
  startGroupBuy: (catalogItemId: string, resident?: string) =>
    post<{ catalog_item_id: string; started: boolean; mock: boolean }>(
      `/api/shared-demand/${encodeURIComponent(catalogItemId)}/group-buy`,
      resident ? { resident_id: resident } : undefined,
    ),
  joinGroupBuy: (catalogItemId: string, resident: string) =>
    post<{ catalog_item_id: string; members: ApiGroupBuyMember[] }>(
      `/api/shared-demand/${encodeURIComponent(catalogItemId)}/group-buy/join`,
      { resident_id: resident },
    ),
  leaveGroupBuy: (catalogItemId: string, resident: string) =>
    request<{ catalog_item_id: string; members: ApiGroupBuyMember[] }>(
      `/api/shared-demand/${encodeURIComponent(catalogItemId)}/group-buy/join?resident_id=${encodeURIComponent(resident)}`,
      { method: 'DELETE' },
    ),
  garden: () => request<{ count: number }>('/api/garden'),

  addTool: (projectId: string, catalogItemId: string, optional = false) =>
    post<ApiProject>(`/api/projects/${projectId}/tools`, {
      catalog_item_id: catalogItemId,
      optional,
    }),
  updateTool: (projectId: string, toolId: string, patch: { optional?: boolean; have_already?: boolean }) =>
    request<ApiProject>(`/api/projects/${projectId}/tools/${toolId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  removeTool: (projectId: string, toolId: string) =>
    request<ApiProject>(`/api/projects/${projectId}/tools/${toolId}`, { method: 'DELETE' }),

  createLoan: async (
    residentId: string,
    body: {
      lender_id: string
      catalog_item_id: string
      window_start: string
      window_end: string
      inventory_id?: string
    },
  ) => {
    const saved = await post<LoanCard>('/api/loans', { borrower_id: residentId, quantity: 1, ...body })
    invalidate(CACHE_KEYS.inventory)
    return saved
  },
  respondLoan: (loanId: string, action: 'accept' | 'decline') =>
    post<LoanCard>(`/api/loans/${loanId}/respond`, { action }),
  pickupLoan: (loanId: string) => post<LoanCard>(`/api/loans/${loanId}/pickup`),
  returnLoan: (loanId: string) => post<LoanCard>(`/api/loans/${loanId}/return`),

  confirmHandoff: (handoffId: string, resident: string) =>
    post<HandoffCard>(`/api/handoffs/${handoffId}/confirm`, { resident_id: resident }),
  receiveHandoff: (handoffId: string) => post<HandoffCard>(`/api/handoffs/${handoffId}/received`),
}

const del = <T>(path: string) => request<T>(path, { method: 'DELETE' })
const patch = <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) })
const enc = encodeURIComponent

/** Admin API. Every call is checked on the server, so hiding the page is only a convenience. */
export const admin = {
  me: () => request<{ admin: true; actor: string }>('/api/admin/me'),
  overview: () => request<AdminOverview>('/api/admin/overview'),
  residents: (q = '') => request<AdminResident[]>(`/api/admin/residents?q=${enc(q)}`),
  updateResident: (id: string, body: Partial<Pick<AdminResident, 'name' | 'street' | 'city' | 'about'>>) =>
    patch<AdminResident>(`/api/admin/residents/${enc(id)}`, body),
  deleteResident: (id: string) => del<{ deleted: string }>(`/api/admin/residents/${enc(id)}`),
  loans: (status?: string) => request<ApiLoan[]>(`/api/admin/loans${status ? `?status=${enc(status)}` : ''}`),
  cancelLoan: (id: string) => post<ApiLoan>(`/api/admin/loans/${enc(id)}/cancel`),
  forceReturnLoan: (id: string) => post<ApiLoan>(`/api/admin/loans/${enc(id)}/force-return`),
  requests: () => request<ApiRequest[]>('/api/admin/requests'),
  closeRequest: (id: string) => post<{ id: string; status: string }>(`/api/admin/requests/${enc(id)}/close`),
  groupBuys: () => request<ApiGroupBuy[]>('/api/admin/group-buys'),
  closeGroupBuy: (itemId: string) => del<{ closed: string }>(`/api/admin/group-buys/${enc(itemId)}`),
  catalog: () => request<AdminCatalogItem[]>('/api/admin/catalog'),
  updateCatalog: async (
    id: string,
    body: Partial<Pick<AdminCatalogItem, 'name' | 'demo_price_cents' | 'default_loan_hours'>>,
  ) => {
    const saved = await patch<AdminCatalogItem>(`/api/admin/catalog/${enc(id)}`, body)
    invalidate(CACHE_KEYS.catalog)
    return saved
  },
  audit: (limit = 100) => request<AdminAuditEntry[]>(`/api/admin/audit?limit=${limit}`),
}

function errorMessage(status: number, detail: unknown) {
  if (typeof detail === 'string') return detail
  if (detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string') {
    return detail.message
  }
  return `The Relay API answered ${status}.`
}

export { setActiveUser, clearAll as clearApiCache } from './cache.ts'
