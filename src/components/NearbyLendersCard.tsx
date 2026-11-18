import { useId, useState } from 'react'
import { useNavigate } from 'react-router'
import { HandHelping, MapPin } from 'lucide-react'
import type { ApiNearbyLender } from '../api/types.ts'
import { pointsFromDistances } from '../data/chatMapPreview.ts'
import type { NeighborMatch, ToolCondition } from '../data/lending.ts'
import { useLoanRequests } from '../state/loanStore.ts'
import { ChatMapPreview } from './ChatMapPreview.tsx'

const KNOWN_CONDITIONS: readonly ToolCondition[] = ['Excellent', 'Good', 'Fair']

function toCondition(value: string): ToolCondition {
  return (KNOWN_CONDITIONS as readonly string[]).includes(value) ? (value as ToolCondition) : 'Good'
}

function initialsFor(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase()
}

/** A simple now→now+maxLoanHours window, so Request to borrow needs no scheduling UI here. */
function fakeMatchFor(lender: ApiNearbyLender, catalogItemId: string): NeighborMatch {
  const start = new Date()
  const end = new Date(start.getTime() + Math.max(1, lender.max_loan_hours) * 3_600_000)
  return {
    id: lender.inventory_id ?? '',
    toolName: lender.item,
    itemName: lender.item,
    residentId: lender.lender_id ?? '',
    catalogItemId,
    distance: `${lender.distance_miles.toFixed(1)} mi`,
    condition: toCondition(lender.condition),
    notes: '',
    pickupWindows: [
      {
        id: 'now',
        label: 'As soon as possible',
        available: true,
        returnWindowIds: ['due'],
        start: start.toISOString(),
        end: start.toISOString(),
      },
    ],
    returnWindows: [
      {
        id: 'due',
        label: `Within ${lender.max_loan_hours}h`,
        available: true,
        end: end.toISOString(),
      },
    ],
    resident: {
      id: lender.lender_id ?? '',
      name: lender.display_name,
      initials: initialsFor(lender.display_name),
      street: '',
    },
  }
}

export function NearbyLendersCard({
  item,
  radiusMiles,
  includeDemo,
  lenders,
  summary,
}: {
  item: { id: string; name: string }
  radiusMiles: number
  includeDemo: boolean
  lenders: ApiNearbyLender[]
  summary: string
}) {
  const headingId = useId()
  const { requestLoan } = useLoanRequests()
  const navigate = useNavigate()
  const [sentIds, setSentIds] = useState<Set<string>>(new Set())
  const [busyId, setBusyId] = useState<string | null>(null)
  const [errorById, setErrorById] = useState<Record<string, string>>({})

  const mapPoints = pointsFromDistances(
    lenders.map((lender, index) => ({
      id: lender.inventory_id ?? `lender-${index}`,
      label: lender.display_name,
      distance: lender.distance_miles,
    })),
    { numbered: true },
  )

  async function onRequest(lender: ApiNearbyLender) {
    if (!lender.inventory_id || !lender.lender_id || busyId) return
    const key = lender.inventory_id
    setBusyId(key)
    setErrorById((current) => ({ ...current, [key]: '' }))
    const match = fakeMatchFor(lender, item.id)
    const problem = await requestLoan(match, 'now', 'due')
    setBusyId(null)
    if (problem) {
      setErrorById((current) => ({ ...current, [key]: problem }))
      return
    }
    setSentIds((current) => new Set(current).add(key))
  }

  return (
    <div className="tool-card" aria-labelledby={headingId}>
      <div className="tool-card-copy">
        <p className="eyebrow">Closest with {item.name.toLowerCase()}</p>
        <h2 id={headingId} className="tool-card-title">
          {item.name}
        </h2>
        <p className="tool-card-summary">
          {summary} Within {radiusMiles} mile{radiusMiles === 1 ? '' : 's'}
          {includeDemo ? ', including demo listings.' : '.'}
        </p>
      </div>
      {lenders.length === 0 ? (
        <p className="match-none">{summary}</p>
      ) : (
        <>
          <ChatMapPreview points={mapPoints} title={`Closest neighbors with ${item.name}`} />
          <ul className="match-list">
            {lenders.map((lender, index) => {
              const key = lender.inventory_id ?? `lender-${index}`
              const sent = sentIds.has(key)
              const busy = busyId === key
              const error = errorById[key]
              return (
                <li key={key}>
                  <NearbyLenderRow
                    rank={index + 1}
                    lender={lender}
                    sent={sent}
                    busy={busy}
                    error={error}
                    onRequest={() => void onRequest(lender)}
                    onOpenMap={() =>
                      lender.lender_id
                        ? void navigate(`/neighborhood?select=${encodeURIComponent(lender.lender_id)}`)
                        : undefined
                    }
                  />
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}

function NearbyLenderRow({
  rank,
  lender,
  sent,
  busy,
  error,
  onRequest,
  onOpenMap,
}: {
  rank: number
  lender: ApiNearbyLender
  sent: boolean
  busy: boolean
  error?: string
  onRequest: () => void
  onOpenMap: () => void
}) {
  const titleId = useId()
  const distanceLabel = `${lender.distance_miles.toFixed(1)} mi away`

  return (
    <article className="match-card" aria-labelledby={titleId}>
      <div className="match-top">
        <span className="match-avatar" aria-hidden="true">
          {rank}
        </span>
        <div className="match-copy">
          <div className="match-title-row">
            <h5 id={titleId} className="match-title">
              {lender.display_name}
            </h5>
            <span className={`match-condition match-condition-${lender.condition.toLowerCase()}`}>
              {lender.condition || 'Unknown'}
            </span>
          </div>
          <p className="match-place">
            <MapPin aria-hidden="true" size={14} />
            <span>{distanceLabel}</span>
          </p>
          <p className="match-notes">
            {lender.quantity} available · can lend for up to {lender.max_loan_hours} hour
            {lender.max_loan_hours === 1 ? '' : 's'}
            {lender.demo ? ' · Demo listing' : ''}
          </p>
        </div>
      </div>
      {error ? (
        <p className="loan-form-hint" role="alert">
          {error}
        </p>
      ) : null}
      <div className="loan-actions">
        {lender.demo ? (
          <button type="button" className="loan-back" disabled>
            Demo listing
          </button>
        ) : sent ? (
          <p className="activity-success" role="status">
            Request sent
          </p>
        ) : (
          <button type="button" className="tool-primary" disabled={busy} onClick={onRequest}>
            <HandHelping aria-hidden="true" size={18} />
            {busy ? 'Sending…' : 'Request to borrow'}
          </button>
        )}
        {lender.lender_id ? (
          <button type="button" className="loan-back" onClick={onOpenMap}>
            Open on map
          </button>
        ) : null}
      </div>
    </article>
  )
}
