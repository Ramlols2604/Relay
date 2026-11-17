import { useCallback, useId } from 'react'
import { useSearchParams } from 'react-router'
import { ShieldCheck } from 'lucide-react'
import { admin } from '../api/client.ts'
import { GlassCard } from '../components/GlassCard.tsx'
import { adminTabLabels, adminTabs, parseTab, type AdminTab } from '../data/admin.ts'
import { useLoad } from './admin/hooks.ts'
import {
  AuditSection,
  CatalogSection,
  GroupBuysSection,
  LoansSection,
  OverviewSection,
  PeopleSection,
  RequestsSection,
} from './admin/sections.tsx'

const sections: Record<AdminTab, () => React.JSX.Element> = {
  overview: OverviewSection,
  people: PeopleSection,
  loans: LoansSection,
  requests: RequestsSection,
  groupbuys: GroupBuysSection,
  catalog: CatalogSection,
  audit: AuditSection,
}

export function AdminPage() {
  const headingId = useId()
  const [params, setParams] = useSearchParams()
  const tab = parseTab(params.get('tab'))
  const check = useCallback(() => admin.me(), [])
  const { data, error, loading } = useLoad(check)
  const Section = sections[tab]

  const denied = error !== null && /not an admin|sign in again|verify/i.test(error)

  return (
    <section className="admin-page" aria-labelledby={headingId}>
      <GlassCard tone="strong" className="admin-hero">
        <p className="eyebrow">
          <ShieldCheck aria-hidden="true" size={14} /> Admin
        </p>
        <h1 id={headingId} className="activity-title">
          Manage Relay
        </h1>
        <p className="hint">Changes here affect real accounts and are written to the audit log.</p>
      </GlassCard>

      {loading ? (
        <GlassCard tone="glass">
          <p className="hint">Checking access…</p>
        </GlassCard>
      ) : !data ? (
        <GlassCard tone="glass">
          <h2 className="match-title">{denied ? 'You do not have admin access' : 'Admin is unavailable'}</h2>
          <p className="hint" role="alert">
            {denied
              ? 'Ask an existing admin to add your user ID to RELAY_ADMIN_USER_IDS on the API.'
              : (error ?? 'The API did not answer.')}
          </p>
        </GlassCard>
      ) : (
        <>
          <div className="admin-tabs" role="tablist" aria-label="Admin sections">
            {adminTabs.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={tab === id ? 'admin-tab admin-tab-active' : 'admin-tab'}
                onClick={() => setParams({ tab: id })}
              >
                {adminTabLabels[id]}
              </button>
            ))}
          </div>
          <GlassCard tone="glass" className="admin-panel">
            <Section key={tab} />
          </GlassCard>
        </>
      )}
    </section>
  )
}
