import { useEffect, useId, useState } from 'react'
import { Users } from 'lucide-react'
import { api } from '../api/client.ts'
import type { ApiSharedDemand, ApiSharedDemandGroup } from '../api/types.ts'
import { isMember, orphanGroupBuys } from '../data/groupBuys.ts'
import { useShelfResident } from '../state/shelfResidentStore.ts'
import { GlassCard } from './GlassCard.tsx'

const refreshMs = 10_000

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`

/** Items several neighbors are asking for, with a mock "group buy" action. */
export function SharedDemandCard() {
  const headingId = useId()
  const me = useShelfResident()
  const [demand, setDemand] = useState<ApiSharedDemand | null>(null)
  const [version, setVersion] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    const load = () =>
      api
        .sharedDemand()
        .then((next) => {
          if (!live) return
          setDemand(next)
          setError(null)
        })
        .catch((caught: unknown) => {
          if (live) setError(caught instanceof Error ? caught.message : 'Could not load shared demand.')
        })
    void load()
    const timer = window.setInterval(() => void load(), refreshMs)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [version])

  const run = async (id: string, action: () => Promise<unknown>, failure: string) => {
    if (busy) return
    setBusy(id)
    try {
      await action()
      setVersion((current) => current + 1)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : failure)
    } finally {
      setBusy(null)
    }
  }

  const groups = demand?.groups ?? []
  const orphans = orphanGroupBuys(demand)
  if (!error && groups.length === 0 && orphans.length === 0) return null

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
          const done = group.group_buy_started
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
                    <GroupBuyMembers
                      group={group}
                      me={me}
                      busy={busy !== null}
                      onJoin={() =>
                        void run(group.catalog_item_id, () => api.joinGroupBuy(group.catalog_item_id, me), 'Could not join the group buy.')
                      }
                      onLeave={() =>
                        void run(group.catalog_item_id, () => api.leaveGroupBuy(group.catalog_item_id, me), 'Could not leave the group buy.')
                      }
                    />
                  ) : (
                    <button
                      type="button"
                      className="loan-lender"
                      disabled={busy !== null}
                      onClick={() =>
                        void run(group.catalog_item_id, () => api.startGroupBuy(group.catalog_item_id, me), 'Could not start the group buy.')
                      }
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
        {orphans.map((buy) => (
          <li key={buy.catalog_item_id} className="exchange-part">
            <p className="match-person-name">{buy.name} · group buy</p>
            <GroupBuyMembers
              group={buy}
              me={me}
              busy={busy !== null}
              onJoin={() => void run(buy.catalog_item_id, () => api.joinGroupBuy(buy.catalog_item_id, me), 'Could not join the group buy.')}
              onLeave={() => void run(buy.catalog_item_id, () => api.leaveGroupBuy(buy.catalog_item_id, me), 'Could not leave the group buy.')}
            />
          </li>
        ))}
      </ul>
    </GlassCard>
  )
}

function GroupBuyMembers({
  group,
  me,
  busy,
  onJoin,
  onLeave,
}: {
  group: Pick<ApiSharedDemandGroup, 'members' | 'member_share_cents'>
  me: string
  busy: boolean
  onJoin: () => void
  onLeave: () => void
}) {
  const joined = isMember(group.members, me)
  return (
    <>
      <p className="activity-success" role="status">
        Group buy started · {group.members.length} {group.members.length === 1 ? 'neighbor' : 'neighbors'} in
        {group.member_share_cents !== null ? ` · ${dollars(group.member_share_cents)} each` : ''}
      </p>
      {group.members.length > 0 ? (
        <ul className="match-list">
          {group.members.map((member) => (
            <li key={member.resident_id} className="match-person">
              <span className="match-avatar" aria-hidden="true">
                {member.initials}
              </span>
              <span className="match-person-name">{member.resident_id === me ? 'You' : member.name}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <button type="button" className="loan-lender" disabled={busy} onClick={joined ? onLeave : onJoin}>
        {joined ? 'Leave group buy' : 'Join group buy'}
      </button>
    </>
  )
}
