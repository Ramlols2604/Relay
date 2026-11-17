import type { AdminAuditEntry, AdminOverview } from '../api/types.ts'

export const adminTabs = ['overview', 'people', 'loans', 'requests', 'groupbuys', 'catalog', 'audit'] as const
export type AdminTab = (typeof adminTabs)[number]

export const adminTabLabels: Record<AdminTab, string> = {
  overview: 'Overview',
  people: 'People',
  loans: 'Loans',
  requests: 'Requests',
  groupbuys: 'Group buys',
  catalog: 'Catalog',
  audit: 'Audit log',
}

export function parseTab(value: string | null): AdminTab {
  return (adminTabs as readonly string[]).includes(value ?? '') ? (value as AdminTab) : 'overview'
}

export function dollars(cents: number): string {
  const safe = Number.isFinite(cents) ? Math.round(cents) : 0
  return `${safe < 0 ? '-' : ''}$${(Math.abs(safe) / 100).toFixed(2)}`
}

/** "12.50" or "12" to cents. Null for anything that is not a non-negative amount with at most two decimals. */
export function centsFromInput(value: string): number | null {
  const text = value.trim().replace(/^\$/, '')
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null
  return Math.round(Number(text) * 100)
}

export type IntegrationRow = { name: string; state: 'ok' | 'missing' | 'error'; note: string }

/** One row per outside service, so a person can see at a glance what is real and what is missing. */
export function integrationRows(integrations: AdminOverview['integrations']): IntegrationRow[] {
  const snowflake = integrations.snowflake.snowflake
  return [
    {
      name: 'Snowflake',
      state: snowflake === 'ok' ? 'ok' : snowflake === 'error' ? 'error' : 'missing',
      note:
        snowflake === 'ok'
          ? 'Shared inventory and requests are live.'
          : snowflake === 'error'
            ? (integrations.snowflake.snowflake_message ?? 'The connection failed.')
            : 'Not configured. Inventory and shared demand use the local database only.',
    },
    {
      name: 'Ollama (local model)',
      state: integrations.ollama.configured ? 'ok' : 'missing',
      note: integrations.ollama.configured
        ? `Chat tries ${integrations.ollama.model ?? 'the model'} first.`
        : 'OLLAMA_HOST is not set.',
    },
    {
      name: 'Gemini',
      state: integrations.gemini ? 'ok' : 'missing',
      note: integrations.gemini ? 'Used when no local model answers.' : 'No key.',
    },
    {
      name: 'Backboard',
      state: integrations.backboard ? 'ok' : 'missing',
      note: integrations.backboard ? 'Configured.' : 'No key.',
    },
    {
      name: 'Clerk sign-in',
      state: integrations.clerk ? 'ok' : 'missing',
      note: integrations.clerk ? 'API verifies sign-in tokens.' : 'Secret key or issuer missing on the API.',
    },
    {
      name: 'Admin access',
      state: integrations.admins_configured > 0 ? 'ok' : 'missing',
      note:
        integrations.admins_configured > 0
          ? `${integrations.admins_configured} admin${integrations.admins_configured === 1 ? '' : 's'} allowed.`
          : 'RELAY_ADMIN_USER_IDS is empty.',
    },
  ]
}

const actionText: Record<string, string> = {
  'resident.update': 'Edited a resident',
  'resident.delete': 'Removed a resident',
  'loan.cancel': 'Cancelled a loan',
  'loan.force_return': 'Marked a loan returned',
  'request.close': 'Closed a request',
  'group_buy.close': 'Closed a group buy',
  'catalog.update': 'Changed a catalog item',
}

export function auditSummary(entry: AdminAuditEntry): string {
  const what = actionText[entry.action] ?? entry.action
  const detail = Object.entries(entry.detail)
    .map(([key, value]) => `${key.replace(/_/g, ' ')}: ${String(value)}`)
    .join(', ')
  return `${what} (${entry.target_id})${detail ? ` · ${detail}` : ''}`
}
