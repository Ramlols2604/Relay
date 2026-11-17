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
  ApiResident,
  ApiGroupBuyMember,
  ApiSharedDemand,
} from './types.ts'

export const apiBase = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '')

let tokenProvider: () => Promise<string | null> = async () => null

/** Clerk session token. The app sets this after sign-in. Do not paste a token by hand. */
export function setAuthTokenProvider(provider: () => Promise<string | null>) {
  tokenProvider = provider
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
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = body && typeof body === 'object' && 'detail' in body ? body.detail : body
    throw new ApiError(response.status, detail)
  }
  return body as T
}

function post<T>(path: string, body?: unknown) {
  return request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
}

type LoanCard = { type: 'loan_status'; record: 'loan' } & ApiLoan
type HandoffCard = { type: 'loan_status'; record: 'handoff' } & ApiHandoff

export const api = {
  chat: (residentId: string, message: string) =>
    post<ApiChatCard>('/api/chat', { resident_id: residentId, message }),
  confirmRequest: (residentId: string, requestId: string) =>
    post<ApiChatCard>(`/api/requests/${requestId}/confirm`, { resident_id: residentId }),
  residents: () => request<ApiResident[]>('/api/residents'),
  saveProfile: (body: {
    clerk_user_id: string
    name: string
    email: string
    initials: string
    street: string
    city?: string
    about?: string
  }) =>
    post<{ id: string; name: string; resident_id: string; city: string; about: string; onboarded: boolean }>(
      '/api/me',
      body,
    ),
  profile: (clerkUserId: string) =>
    request<{ resident_id: string | null; city: string; about: string; onboarded: boolean }>(
      `/api/me?clerk_user_id=${encodeURIComponent(clerkUserId)}`,
    ),
  inventory: (residentId: string) =>
    request<ApiInventory>(`/api/inventory?resident_id=${encodeURIComponent(residentId)}`),
  createInventory: (
    residentId: string,
    body: { name: string; category: string; quantity: number; condition: string; notes: string; available_to_lend: boolean },
  ) => post<ApiInventoryItem>('/api/inventory', { resident_id: residentId, ...body }),
  updateInventory: (
    residentId: string,
    itemId: string,
    body: { name: string; category: string; quantity: number; condition: string; notes: string; available_to_lend: boolean },
  ) =>
    request<ApiInventoryItem>(`/api/inventory/${encodeURIComponent(itemId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ resident_id: residentId, ...body }),
    }),
  deleteInventory: (residentId: string, itemId: string) =>
    request<{ deleted: string }>(
      `/api/inventory/${encodeURIComponent(itemId)}?resident_id=${encodeURIComponent(residentId)}`,
      { method: 'DELETE' },
    ),
  neighborhood: (residentId: string) =>
    request<ApiInventory>(`/api/neighborhood?resident_id=${encodeURIComponent(residentId)}`),
  catalog: () => request<ApiCatalogItem[]>('/api/catalog'),
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

  createLoan: (
    residentId: string,
    body: {
      lender_id: string
      catalog_item_id: string
      window_start: string
      window_end: string
      inventory_id?: string
    },
  ) => post<LoanCard>('/api/loans', { borrower_id: residentId, quantity: 1, ...body }),
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
  updateCatalog: (
    id: string,
    body: Partial<Pick<AdminCatalogItem, 'name' | 'demo_price_cents' | 'default_loan_hours'>>,
  ) => patch<AdminCatalogItem>(`/api/admin/catalog/${enc(id)}`, body),
  audit: (limit = 100) => request<AdminAuditEntry[]>(`/api/admin/audit?limit=${limit}`),
}

function errorMessage(status: number, detail: unknown) {
  if (typeof detail === 'string') return detail
  if (detail && typeof detail === 'object' && 'message' in detail && typeof detail.message === 'string') {
    return detail.message
  }
  return `The Relay API answered ${status}.`
}
