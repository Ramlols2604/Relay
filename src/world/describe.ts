import type { ApiActivity, ApiGroupBuy } from '../api/types.ts'
import { overdueSpan } from '../data/overdue.ts'
import { itemName, loanStep } from './activity.ts'
import type { WorldResident } from './layout.ts'

export type Detail = {
  title: string
  subtitle: string
  rows: [label: string, value: string][]
  /** Present for a loan, so the tracker can show where it is. */
  loan?: { status: string; step: number; overdue: boolean }
}

export type DescribeContext = {
  residents: ReadonlyMap<string, WorldResident>
  activity: ApiActivity | null
  names: ReadonlyMap<string, string>
  groupBuys: readonly ApiGroupBuy[]
  finished: number
  /** Which loan or handoff a walking trip belongs to. */
  tripSubjects: ReadonlyMap<string, string>
}

const who = (context: DescribeContext, id: string) => context.residents.get(id)?.name ?? id
const when = (iso: string | null) => {
  const date = new Date(iso ?? '')
  return Number.isNaN(date.getTime()) ? 'a time to agree on' : date.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })
}
const label = (status: string) => status.replace('_', ' ').replace(/^./, (c) => c.toUpperCase())

/** What the right-hand panel says about whatever was clicked. Null when it no longer exists. */
export function describe(selection: string | null, context: DescribeContext): Detail | null {
  if (!selection) return null
  if (selection === 'hub') {
    return {
      title: 'Relay Hub',
      subtitle: 'Where neighbors pool what they need',
      rows: [
        ['Exchanges finished', String(context.finished)],
        ...(context.groupBuys.length === 0
          ? ([['Group buys', 'None started']] as [string, string][])
          : context.groupBuys.map((buy): [string, string] => [buy.name, `${buy.members.length} neighbor${buy.members.length === 1 ? '' : 's'}`])),
      ],
    }
  }
  if (selection === 'park') {
    return { title: 'Garden', subtitle: 'One flower for every exchange finished', rows: [['Flowers', String(Math.min(60, context.finished))]] }
  }
  if (selection.startsWith('t:')) {
    const subject = context.tripSubjects.get(selection.slice(2))
    return subject ? describe(`s:${subject}`, context) : null
  }
  if (selection.startsWith('h:')) return describeHouse(selection.slice(2), context)
  if (selection.startsWith('s:')) return describeSubject(selection.slice(2), context)
  return null
}

function describeHouse(id: string, context: DescribeContext): Detail | null {
  const resident = context.residents.get(id)
  if (!resident) return null
  const loans = context.activity?.loans ?? []
  const open = (loan: { status: string }) => ['requested', 'confirmed', 'picked_up'].includes(loan.status)
  const lending = loans.filter((loan) => loan.lender_id === id && open(loan))
  const borrowing = loans.filter((loan) => loan.borrower_id === id && open(loan))
  const holding = loans.filter((loan) => loan.borrower_id === id && loan.status === 'picked_up')
  return {
    title: resident.name,
    subtitle: [resident.street, resident.city].filter(Boolean).join(', '),
    rows: [
      ['Lending out', String(lending.length)],
      ['Borrowing', String(borrowing.length)],
      ['Overdue', String(holding.filter((loan) => loan.overdue === true).length)],
      ['Has on loan', holding.length ? holding.map((loan) => itemName(loan.catalog_item_id, context.names)).join(', ') : 'Nothing'],
    ],
  }
}

function describeSubject(id: string, context: DescribeContext): Detail | null {
  const loan = context.activity?.loans.find((row) => row.loan_id === id)
  if (loan) {
    const rows: Detail['rows'] = [
      ['Status', label(loan.status)],
      ['From', who(context, loan.lender_id)],
      ['To', who(context, loan.borrower_id)],
      ['Back by', when(loan.window.end)],
    ]
    if (loan.overdue === true) rows.push(['Overdue by', overdueSpan(loan.overdue_minutes ?? 0)])
    return {
      title: itemName(loan.catalog_item_id, context.names),
      subtitle: `${who(context, loan.lender_id)} → ${who(context, loan.borrower_id)}`,
      rows,
      loan: { status: loan.status, step: loanStep(loan.status), overdue: loan.overdue === true },
    }
  }
  const handoff = context.activity?.handoffs.find((row) => row.id === id)
  if (handoff) {
    return {
      title: 'Handoff',
      subtitle: `To ${who(context, handoff.recipient_id)}`,
      rows: [
        ['Status', label(handoff.status)],
        ['From', handoff.allocations.map((allocation) => who(context, allocation.resident_id)).join(', ') || 'No one yet'],
        ['To', who(context, handoff.recipient_id)],
      ],
    }
  }
  return null
}
