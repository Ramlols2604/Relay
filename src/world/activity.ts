import type { ApiActivity, ApiLoan } from '../api/types.ts'
import { overdueSpan } from '../data/overdue.ts'

/** What the town shows above a house. */
export type BeaconKind = 'request' | 'ready' | 'out' | 'due-soon' | 'overdue'

export type Beacon = {
  id: string
  residentId: string
  kind: BeaconKind
  label: string
  /** The loan or handoff this belongs to. */
  subjectId: string
}

/** Someone walking between two houses with something in hand. */
export type Trip = {
  id: string
  kind: 'loan' | 'handoff'
  subjectId: string
  item: string
  fromId: string
  toId: string
  /** Walks back and forth until the state changes, or once when it is a one-off reaction to a change. */
  repeat: boolean
  purpose: 'pickup' | 'return' | 'delivery'
}

export type SceneState = { beacons: Beacon[]; trips: Trip[] }

const open = new Set(['requested', 'confirmed', 'picked_up'])

export function isOpenLoan(loan: Pick<ApiLoan, 'status'>) {
  return open.has(loan.status)
}

export function itemName(id: string, names: ReadonlyMap<string, string>) {
  return names.get(id) ?? id
}

/**
 * Turn the API's loans and handoffs into things to draw. Anything that touches a neighbor with no house
 * in the town is left out, so nothing is drawn floating in space.
 */
export function sceneFrom(activity: ApiActivity | null, housed: ReadonlySet<string>, names: ReadonlyMap<string, string>): SceneState {
  const beacons: Beacon[] = []
  const trips: Trip[] = []
  if (!activity) return { beacons, trips }

  for (const loan of activity.loans) {
    if (!housed.has(loan.lender_id) || !housed.has(loan.borrower_id)) continue
    const item = itemName(loan.catalog_item_id, names)
    if (loan.status === 'requested') {
      beacons.push({ id: `b-${loan.loan_id}`, residentId: loan.lender_id, kind: 'request', label: `${item} requested`, subjectId: loan.loan_id })
    } else if (loan.status === 'confirmed') {
      beacons.push({ id: `b-${loan.loan_id}`, residentId: loan.lender_id, kind: 'ready', label: `${item} ready for pickup`, subjectId: loan.loan_id })
      trips.push({ id: `t-${loan.loan_id}`, kind: 'loan', subjectId: loan.loan_id, item, fromId: loan.borrower_id, toId: loan.lender_id, repeat: true, purpose: 'pickup' })
    } else if (loan.status === 'picked_up') {
      const overdue = loan.overdue === true
      const soon = !overdue && loan.due_soon === true
      beacons.push({
        id: `b-${loan.loan_id}`,
        residentId: loan.borrower_id,
        kind: overdue ? 'overdue' : soon ? 'due-soon' : 'out',
        label: overdue ? `${item} ${overdueSpan(loan.overdue_minutes ?? 0)} overdue` : soon ? `${item} due back soon` : `${item} on loan`,
        subjectId: loan.loan_id,
      })
    }
  }

  for (const handoff of activity.handoffs) {
    const donors = handoff.allocations.map((allocation) => allocation.resident_id).filter((id) => housed.has(id))
    if (!housed.has(handoff.recipient_id) || donors.length === 0) continue
    if (handoff.status === 'proposed') {
      beacons.push({ id: `b-${handoff.id}`, residentId: handoff.recipient_id, kind: 'request', label: 'Handoff proposed', subjectId: handoff.id })
    } else if (handoff.status === 'confirmed') {
      donors.forEach((donor, index) =>
        trips.push({
          id: `t-${handoff.id}-${index}`,
          kind: 'handoff',
          subjectId: handoff.id,
          item: 'handoff',
          fromId: donor,
          toId: handoff.recipient_id,
          repeat: true,
          purpose: 'delivery',
        }),
      )
    }
  }
  return { beacons, trips }
}

/** A loan's status last time we looked, so a change can be shown as someone making the trip. */
export type StatusMemory = Record<string, string>

export function rememberStatuses(activity: ApiActivity | null): StatusMemory {
  return Object.fromEntries((activity?.loans ?? []).map((loan) => [loan.loan_id, loan.status]))
}

/**
 * One-off trips for loans that just changed: picked up (lender's house to the borrower's) and returned
 * (back again). Nothing plays for loans we are seeing for the first time, so loading the page is calm.
 */
export function tripsForChanges(
  before: StatusMemory,
  activity: ApiActivity | null,
  housed: ReadonlySet<string>,
  names: ReadonlyMap<string, string>,
): Trip[] {
  if (!activity || Object.keys(before).length === 0) return []
  const trips: Trip[] = []
  for (const loan of activity.loans) {
    const was = before[loan.loan_id]
    if (!was || was === loan.status || !housed.has(loan.lender_id) || !housed.has(loan.borrower_id)) continue
    const item = itemName(loan.catalog_item_id, names)
    if (was === 'confirmed' && loan.status === 'picked_up') {
      trips.push({ id: `o-${loan.loan_id}-${loan.status}`, kind: 'loan', subjectId: loan.loan_id, item, fromId: loan.lender_id, toId: loan.borrower_id, repeat: false, purpose: 'pickup' })
    } else if (was === 'picked_up' && loan.status === 'returned') {
      trips.push({ id: `o-${loan.loan_id}-${loan.status}`, kind: 'loan', subjectId: loan.loan_id, item, fromId: loan.borrower_id, toId: loan.lender_id, repeat: false, purpose: 'return' })
    }
  }
  return trips
}

export type Kpis = { activeLoans: number; overdue: number; finished: number; neighbors: number }

export function kpisFrom(activity: ApiActivity | null, finished: number, neighbors: number): Kpis {
  const loans = activity?.loans ?? []
  return {
    activeLoans: loans.filter(isOpenLoan).length,
    overdue: loans.filter((loan) => loan.overdue === true).length,
    finished: Math.max(0, Math.floor(Number.isFinite(finished) ? finished : 0)),
    neighbors,
  }
}

/** Six-step tracker like the Dabba order tracker, for a loan. */
export const loanSteps = ['Requested', 'Confirmed', 'Picked up', 'Returned'] as const

export function loanStep(status: string): number {
  return { requested: 0, confirmed: 1, picked_up: 2, returned: 3 }[status] ?? -1
}
