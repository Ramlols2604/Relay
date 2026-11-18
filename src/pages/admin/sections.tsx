import { useCallback, useDeferredValue, useState, type ReactNode } from 'react'
import { admin } from '../../api/client.ts'
import type { AdminCatalogItem, AdminResident, ApiGroupBuy, ApiLoan, ApiRequest } from '../../api/types.ts'
import { auditSummary, centsFromInput, dollars, integrationRows, llmOrderSummary } from '../../data/admin.ts'
import { useLoad, useReload, useRunner } from './hooks.ts'

function Status({ loading, error, children }: { loading: boolean; error: string | null; children: ReactNode }) {
  return (
    <>
      {error ? (
        <p className="admin-error" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p className="hint">Loading…</p> : children}
    </>
  )
}

function Problem({ message }: { message: string | null }) {
  return message ? (
    <p className="admin-error" role="alert">
      {message}
    </p>
  ) : null
}

const ask = (message: string) => typeof window !== 'undefined' && window.confirm(message)
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '')

export function OverviewSection() {
  const load = useCallback(() => admin.overview(), [])
  const { data, error, loading } = useLoad(load)
  return (
    <Status loading={loading} error={error}>
      {data ? (
        <>
          <ul className="admin-stats" aria-label="Totals">
            {Object.entries(data.counts).map(([key, value]) => (
              <li key={key}>
                <span className="admin-stat-value">{value}</span>
                <span className="admin-stat-label">{key.replace(/_/g, ' ')}</span>
              </li>
            ))}
          </ul>
          <h3 className="admin-h3">Loans by status</h3>
          <p className="hint">
            {Object.entries(data.loans_by_status)
              .map(([key, value]) => `${key.replace(/_/g, ' ')}: ${value}`)
              .join(' · ') || 'No loans yet'}
          </p>
          <h3 className="admin-h3">Connected services</h3>
          <p className="hint">Extraction order: {llmOrderSummary(data.integrations.llm_order)}</p>
          <ul className="admin-list">
            {integrationRows(data.integrations).map((row) => (
              <li key={row.name} className="admin-row">
                <span className={`admin-pill admin-pill-${row.state}`}>
                  {row.state === 'ok' ? 'Live' : row.state === 'error' ? 'Error' : 'Missing'}
                </span>
                <span className="admin-grow">
                  <strong>{row.name}</strong>
                  <span className="hint">{row.note}</span>
                </span>
              </li>
            ))}
          </ul>
          {!data.integrations.auth_enforced ? (
            <p className="admin-error" role="alert">
              Sign-in is not enforced on this API (open mode). Do not run this way in production.
            </p>
          ) : null}
        </>
      ) : null}
    </Status>
  )
}

export function PeopleSection() {
  const [q, setQ] = useState('')
  const deferred = useDeferredValue(q)
  const { version, reload } = useReload()
  const load = useCallback(() => admin.residents(deferred), [deferred])
  const { data, error, loading } = useLoad(load, version)
  const [editing, setEditing] = useState<string | null>(null)
  const { run, busy, error: actionError } = useRunner(reload)

  return (
    <>
      <label className="admin-field">
        <span>Search people</span>
        <input type="search" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Name, street or city" />
      </label>
      <Problem message={actionError} />
      <Status loading={loading} error={error}>
        {data && data.length === 0 ? <p className="hint">No one matches.</p> : null}
        <ul className="admin-list">
          {data?.map((person) =>
            editing === person.id ? (
              <ResidentEditor
                key={person.id}
                person={person}
                busy={busy}
                onCancel={() => setEditing(null)}
                onSave={async (body) => {
                  if (await run(() => admin.updateResident(person.id, body))) setEditing(null)
                }}
              />
            ) : (
              <li key={person.id} className="admin-row">
                <span className="admin-grow">
                  <strong>{person.name}</strong>
                  <span className="hint">
                    {person.id} · {[person.street, person.city].filter(Boolean).join(', ') || 'No address'} ·{' '}
                    {person.loans} loan{person.loans === 1 ? '' : 's'}
                  </span>
                </span>
                <button type="button" className="admin-button" onClick={() => setEditing(person.id)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="admin-button admin-danger"
                  disabled={busy}
                  onClick={() => {
                    if (ask(`Remove ${person.name}? This cannot be undone.`)) void run(() => admin.deleteResident(person.id))
                  }}
                >
                  Remove
                </button>
              </li>
            ),
          )}
        </ul>
      </Status>
    </>
  )
}

function ResidentEditor({
  person,
  busy,
  onSave,
  onCancel,
}: {
  person: AdminResident
  busy: boolean
  onSave: (body: { name: string; street: string; city: string; about: string }) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState({ name: person.name, street: person.street, city: person.city, about: person.about })
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [key]: event.target.value }))
  return (
    <li className="admin-row admin-editor">
      <label className="admin-field">
        <span>Name</span>
        <input value={form.name} onChange={set('name')} maxLength={80} />
      </label>
      <label className="admin-field">
        <span>Street</span>
        <input value={form.street} onChange={set('street')} maxLength={120} />
      </label>
      <label className="admin-field">
        <span>City</span>
        <input value={form.city} onChange={set('city')} maxLength={80} />
      </label>
      <label className="admin-field">
        <span>About</span>
        <textarea value={form.about} onChange={set('about')} maxLength={500} rows={2} />
      </label>
      <div className="admin-actions">
        <button type="button" className="admin-button" disabled={busy || !form.name.trim()} onClick={() => onSave(form)}>
          Save
        </button>
        <button type="button" className="admin-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </li>
  )
}

const loanFilters = ['', 'requested', 'confirmed', 'picked_up', 'returned', 'declined'] as const

export function LoansSection() {
  const [status, setStatus] = useState<string>('')
  const { version, reload } = useReload()
  const load = useCallback(() => admin.loans(status || undefined), [status])
  const { data, error, loading } = useLoad(load, version)
  const { run, busy, error: actionError } = useRunner(reload)

  return (
    <>
      <label className="admin-field">
        <span>Status</span>
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          {loanFilters.map((value) => (
            <option key={value} value={value}>
              {value ? value.replace('_', ' ') : 'All'}
            </option>
          ))}
        </select>
      </label>
      <Problem message={actionError} />
      <Status loading={loading} error={error}>
        {data && data.length === 0 ? <p className="hint">No loans.</p> : null}
        <ul className="admin-list">
          {data?.map((loan: ApiLoan) => (
            <li key={loan.loan_id} className="admin-row">
              <span className="admin-grow">
                <strong>
                  {loan.catalog_item_id} · {loan.lender_id} → {loan.borrower_id}
                </strong>
                <span className="hint">
                  {loan.status.replace('_', ' ')}
                  {loan.overdue ? ' · overdue' : ''} · back by {when(loan.window.end)} · {loan.loan_id}
                </span>
              </span>
              {loan.status === 'picked_up' ? (
                <button
                  type="button"
                  className="admin-button"
                  disabled={busy}
                  onClick={() => {
                    if (ask('Mark this loan as returned?')) void run(() => admin.forceReturnLoan(loan.loan_id))
                  }}
                >
                  Mark returned
                </button>
              ) : null}
              {['requested', 'confirmed', 'picked_up'].includes(loan.status) ? (
                <button
                  type="button"
                  className="admin-button admin-danger"
                  disabled={busy}
                  onClick={() => {
                    if (ask('Cancel this loan?')) void run(() => admin.cancelLoan(loan.loan_id))
                  }}
                >
                  Cancel
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </Status>
    </>
  )
}

export function RequestsSection() {
  const { version, reload } = useReload()
  const load = useCallback(() => admin.requests(), [])
  const { data, error, loading } = useLoad(load, version)
  const { run, busy, error: actionError } = useRunner(reload)

  return (
    <>
      <Problem message={actionError} />
      <Status loading={loading} error={error}>
        {data && data.length === 0 ? <p className="hint">No requests.</p> : null}
        <ul className="admin-list">
          {data?.map((request: ApiRequest) => (
            <li key={request.id} className="admin-row">
              <span className="admin-grow">
                <strong>
                  {request.kind} · {request.catalog_item_id} × {request.quantity}
                </strong>
                <span className="hint">
                  {request.resident_id} · {request.status}
                  {request.raw_text ? ` · “${request.raw_text}”` : ''}
                </span>
              </span>
              {request.status === 'open' ? (
                <button
                  type="button"
                  className="admin-button admin-danger"
                  disabled={busy}
                  onClick={() => {
                    if (ask('Close this request?')) void run(() => admin.closeRequest(request.id))
                  }}
                >
                  Close
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </Status>
    </>
  )
}

export function GroupBuysSection() {
  const { version, reload } = useReload()
  const load = useCallback(() => admin.groupBuys(), [])
  const { data, error, loading } = useLoad(load, version)
  const { run, busy, error: actionError } = useRunner(reload)

  return (
    <>
      <Problem message={actionError} />
      <Status loading={loading} error={error}>
        {data && data.length === 0 ? <p className="hint">No group buys have been started.</p> : null}
        <ul className="admin-list">
          {data?.map((buy: ApiGroupBuy) => (
            <li key={buy.catalog_item_id} className="admin-row">
              <span className="admin-grow">
                <strong>{buy.name}</strong>
                <span className="hint">
                  {buy.members.length} member{buy.members.length === 1 ? '' : 's'}
                  {buy.members.length ? `: ${buy.members.map((member) => member.name).join(', ')}` : ''}
                  {buy.member_share_cents !== null ? ` · ${dollars(buy.member_share_cents)} each` : ''}
                </span>
              </span>
              <button
                type="button"
                className="admin-button admin-danger"
                disabled={busy}
                onClick={() => {
                  if (ask(`Close the ${buy.name} group buy and remove its members?`)) {
                    void run(() => admin.closeGroupBuy(buy.catalog_item_id))
                  }
                }}
              >
                Close
              </button>
            </li>
          ))}
        </ul>
      </Status>
    </>
  )
}

export function CatalogSection() {
  const { version, reload } = useReload()
  const load = useCallback(() => admin.catalog(), [])
  const { data, error, loading } = useLoad(load, version)

  return (
    <Status loading={loading} error={error}>
      <ul className="admin-list">
        {data?.map((item) => <CatalogRow key={`${item.id}-${item.demo_price_cents}-${item.default_loan_hours}-${item.name}`} item={item} onSaved={reload} />)}
      </ul>
    </Status>
  )
}

function CatalogRow({ item, onSaved }: { item: AdminCatalogItem; onSaved: () => void }) {
  const [name, setName] = useState(item.name)
  const [price, setPrice] = useState((item.demo_price_cents / 100).toFixed(2))
  const [hours, setHours] = useState(String(item.default_loan_hours))
  const { run, busy, error } = useRunner(onSaved)
  const cents = centsFromInput(price)
  const loanHours = Number(hours)
  const valid = name.trim() !== '' && cents !== null && Number.isInteger(loanHours) && loanHours >= 1 && loanHours <= 720
  const changed = name !== item.name || cents !== item.demo_price_cents || loanHours !== item.default_loan_hours

  return (
    <li className="admin-row admin-editor">
      <span className="admin-grow">
        <strong>{item.id}</strong>
        <span className="hint">{item.category}</span>
      </span>
      <label className="admin-field">
        <span>Name</span>
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={60} />
      </label>
      <label className="admin-field">
        <span>Price ($)</span>
        <input inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} />
      </label>
      <label className="admin-field">
        <span>Loan hours</span>
        <input inputMode="numeric" value={hours} onChange={(event) => setHours(event.target.value)} />
      </label>
      {!valid ? <p className="admin-error">Enter a name, a price like 60.00, and 1 to 720 hours.</p> : null}
      <Problem message={error} />
      <button
        type="button"
        className="admin-button"
        disabled={busy || !valid || !changed}
        onClick={() =>
          void run(() => admin.updateCatalog(item.id, { name: name.trim(), demo_price_cents: cents ?? 0, default_loan_hours: loanHours }))
        }
      >
        Save
      </button>
    </li>
  )
}

export function AuditSection() {
  const load = useCallback(() => admin.audit(200), [])
  const { data, error, loading } = useLoad(load)
  return (
    <Status loading={loading} error={error}>
      {data && data.length === 0 ? <p className="hint">Nothing has been changed yet.</p> : null}
      <ul className="admin-list">
        {data?.map((entry) => (
          <li key={entry.id} className="admin-row">
            <span className="admin-grow">
              <strong>{auditSummary(entry)}</strong>
              <span className="hint">
                {when(entry.at)} · {entry.actor}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Status>
  )
}
