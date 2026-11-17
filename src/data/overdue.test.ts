import assert from 'node:assert/strict'
import test from 'node:test'
import type { LoanRequest } from './lending.ts'
import { overdueCount, overdueNotice, overdueSpan } from './overdue.ts'

const loan = (extra: Partial<LoanRequest>): LoanRequest => ({
  id: 'l1',
  listingId: 'x',
  toolName: 'Drill',
  itemName: 'Drill',
  lenderId: 'jordan',
  lenderName: 'Jordan Hale',
  lenderInitials: 'JH',
  pickupWindowId: 'p',
  pickupLabel: 'Sat',
  returnWindowId: 'r',
  returnLabel: 'Sun 5pm',
  status: 'Picked up',
  borrowerName: 'Sam Ortiz',
  ...extra,
})

test('spans use the largest whole unit and never round up', () => {
  assert.equal(overdueSpan(0), '1 minute')
  assert.equal(overdueSpan(1), '1 minute')
  assert.equal(overdueSpan(59), '59 minutes')
  assert.equal(overdueSpan(60), '1 hour')
  assert.equal(overdueSpan(185), '3 hours')
  assert.equal(overdueSpan(1439), '23 hours')
  assert.equal(overdueSpan(1440), '1 day')
  assert.equal(overdueSpan(4000), '2 days')
  assert.equal(overdueSpan(Number.NaN), '1 minute')
})

test('borrower and lender read different notices', () => {
  const late = loan({ overdue: true, overdueMinutes: 185 })
  assert.equal(overdueNotice(late, false), 'Your drill is 3 hours overdue. Please return it to Jordan.')
  assert.equal(overdueNotice(late, true), 'Sam still has your drill. It was due back 3 hours ago.')
})

test('due soon and on time', () => {
  assert.match(overdueNotice(loan({ dueSoon: true }), false) ?? '', /due back soon \(Sun 5pm\)/)
  assert.equal(overdueNotice(loan({}), false), null)
})

test('counts only overdue loans', () => {
  assert.equal(overdueCount([loan({ overdue: true }), loan({ dueSoon: true }), loan({})]), 1)
})
