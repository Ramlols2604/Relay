import { useEffect, useId, useState } from 'react'
import { Users } from 'lucide-react'
import { api } from '../api/client.ts'
import type { ApiSharedDemand, ApiSharedDemandGroup } from '../api/types.ts'
import { GlassCard } from './GlassCard.tsx'

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`

/** Items several neighbors are asking for, with a mock "group buy" action. */
export function SharedDemandCard() {
  const headingId = useId()
  const [demand, setDemand] = useState<ApiSharedDemand | null>(null)
  const [started, setStarted] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    api
      .sharedDemand()
      .then((next) => {
        if (live) setDemand(next)
      })
      .catch((caught: unknown) => {
        if (live) setError(caught instanceof Error ? caught.message : 'Could not load shared demand.')
      })
    return () => {
      live = false
    }
  }, [])

  const start = async (group: ApiSharedDemandGroup) => {
    setBusy(group.catalog_item_id)
    try {
      await api.startGroupBuy(group.catalog_item_id)
      setStarted((prev) => new Set(prev).add(group.catalog_item_id))
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not start the group buy.')
    } finally {
      setBusy(null)
    }
  }

  const groups = demand?.groups ?? []
  if (!error && groups.length === 0) return null

  return (
    <GlassCard tone="glass" className="shared-demand" aria-labelledby={headingId}>
      <p className="eyebrow">
        <Users aria-hidden="true" size={14} /> Shared demand
      </p>
      <h2 id={headingId} className="match-title">
        Neighbors asking for the same thing
      </h2>
      {error ? (
        <p className="hint" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="match-list">
        {groups.map((group) => {
          const done = started.has(group.catalog_item_id)
          return (
            <li key={group.catalog_item_id} className="exchange-part">
              <p className="match-person-name">
                {group.name} · {group.request_count} households
              </p>
              {group.shared && group.cost ? (
                <>
                  <p className="hint">
                    {dollars(group.cost.per_household_share_cents)} each if shared, vs{' '}
                    {dollars(group.cost.per_household_buy_cents)} buying alone (saves{' '}
                    {dollars(group.cost.savings_cents)} overall).
                  </p>
                  {done ? (
                    <p className="activity-success" role="status">
                      Group buy started
                    </p>
                  ) : (
                    <button
                      type="button"
                      className="loan-lender"
                      disabled={busy === group.catalog_item_id}
                      onClick={() => void start(group)}
                    >
                      Start a group buy
                    </button>
                  )}
                </>
              ) : (
                <p className="hint">
                  {group.reason === 'owned_nearby'
                    ? 'A neighbor already owns one nearby, so no group buy is needed.'
                    : 'Waiting on neighborhood inventory before a group buy can start.'}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </GlassCard>
  )
}
