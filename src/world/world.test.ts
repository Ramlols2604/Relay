import assert from 'node:assert/strict'
import test from 'node:test'
import type { ApiActivity, ApiLoan } from '../api/types.ts'
import { kpisFrom, loanStep, rememberStatuses, sceneFrom, tripsForChanges } from './activity.ts'
import { HUB_CELL, PARK_CELL, SPACING, boundsOf, layoutLots, streetName, zonesOf, type WorldResident } from './layout.ts'
import { pointAt, routeBetween, routeLength } from './routes.ts'

const person = (id: string, x: number, y: number, extra: Partial<WorldResident> = {}): WorldResident => ({
  id,
  name: id.toUpperCase(),
  initials: id.slice(0, 2).toUpperCase(),
  street: `${x} Willow Court`,
  x,
  y,
  city: 'Charlotte',
  ...extra,
})

const people = [person('avery', 0, 0), person('jordan', 2, 1), person('sam', 3, 3), person('riley', 5, 2), person('noor', 40, 0)]

test('every neighbor gets their own lot and none sit on the hub or park', () => {
  const lots = layoutLots(people, 'avery')
  assert.equal(lots.length, 5)
  const cells = lots.map((lot) => `${lot.col},${lot.row}`)
  assert.equal(new Set(cells).size, cells.length)
  assert.ok(!cells.includes(`${HUB_CELL.col},${HUB_CELL.row}`))
  assert.ok(!cells.includes(`${PARK_CELL.col},${PARK_CELL.row}`))
  assert.deepEqual([lots[0].col, lots[0].row], [0, 0], 'the viewer is at the center')
})

test('the layout is the same every time, whatever order the data arrives in', () => {
  const a = layoutLots(people, 'avery').map((lot) => [lot.id, lot.col, lot.row])
  const b = layoutLots([...people].reverse(), 'avery').map((lot) => [lot.id, lot.col, lot.row])
  assert.deepEqual(a.sort(), b.sort())
})

test('anyone who must be housed is, even when dozens of nearer neighbors would fill the town', () => {
  const crowd = Array.from({ length: 80 }, (_, index) => person(`block-${index}`, index % 9, Math.floor(index / 9)))
  const everyone = [person('me', 0, 0), ...crowd, person('lender', 30, 30)]
  const plain = layoutLots(everyone, 'me', 36)
  assert.ok(!plain.some((lot) => lot.id === 'lender'), 'far away and not required, so left out')
  const required = layoutLots(everyone, 'me', 36, new Set(['lender', 'ghost']))
  assert.ok(required.some((lot) => lot.id === 'lender'))
  assert.equal(required.length, 36, 'the cap still applies to everyone else')
  assert.equal(new Set(required.map((lot) => `${lot.col},${lot.row}`)).size, required.length)
  const hugeRequired = layoutLots(everyone, 'me', 3, new Set(crowd.slice(0, 10).map((resident) => resident.id)))
  assert.equal(hugeRequired.length, 11, 'required neighbors are never dropped, even past the cap')
})

test('far-away neighbors are pulled in so the town stays small', () => {
  const lots = layoutLots(people, 'avery')
  const farthest = Math.max(...lots.map((lot) => Math.max(Math.abs(lot.col), Math.abs(lot.row))))
  assert.ok(farthest <= 8, `farthest cell is ${farthest}`)
})

test('crowded data still never overlaps, and respects the cap', () => {
  const crowd = Array.from({ length: 80 }, (_, index) => person(`n${index}`, index % 3, Math.floor(index / 40)))
  const lots = layoutLots([person('me', 0, 0), ...crowd], 'me', 36)
  assert.equal(lots.length, 36)
  assert.equal(new Set(lots.map((lot) => `${lot.col},${lot.row}`)).size, 36)
})

test('other cities are left out, and a missing viewer or empty data does not crash', () => {
  const mixed = [...people, person('far', 1, 1, { city: 'Raleigh' })]
  assert.ok(!layoutLots(mixed, 'avery').some((lot) => lot.id === 'far'))
  assert.equal(layoutLots(people, 'nobody').length, 5)
  assert.deepEqual(layoutLots([], 'avery'), [])
  assert.equal(boundsOf([]).minX, -SPACING)
})

test('city matching ignores case and spaces', () => {
  const mixed = [
    person('avery', 0, 0, { city: 'Charlotte' }),
    person('jordan', 2, 1, { city: 'charlotte ' }),
    person('sam', 3, 3, { city: 'Char Lotte' }),
    person('far', 1, 1, { city: 'Raleigh' }),
  ]
  const lots = layoutLots(mixed, 'avery')
  assert.deepEqual(
    lots.map((lot) => lot.id).sort(),
    ['avery', 'jordan', 'sam'],
  )
})

test('zones come from street names, biggest first', () => {
  assert.equal(streetName('16 Willow Court'), 'Willow Court')
  assert.equal(streetName('9B Far Road'), 'Far Road')
  assert.equal(streetName('42'), 'Neighborhood')
  const zones = zonesOf(layoutLots([person('a', 0, 0, { street: '1 Elm St' }), person('b', 1, 0, { street: '2 Elm St' }), person('c', 0, 1, { street: '3 Oak Rd' })], 'a'))
  assert.deepEqual(zones.map((zone) => [zone.name, zone.count]), [['Elm St', 2], ['Oak Rd', 1]])
})

test('routes stay on the streets and end exactly at both houses', () => {
  const a = { x: 0, z: 0 }
  const b = { x: 30, z: 20 }
  const route = routeBetween(a, b)
  assert.deepEqual(route[0], a)
  assert.deepEqual(route.at(-1), b)
  for (const point of route.slice(1, -1)) {
    assert.ok(Math.abs(((point.x - SPACING / 2) % SPACING + SPACING) % SPACING) < 1e-9 || Math.abs(((point.z - SPACING / 2) % SPACING + SPACING) % SPACING) < 1e-9, 'a corner lies on a street')
  }
  for (let index = 1; index < route.length; index++) {
    assert.ok(route[index].x === route[index - 1].x || route[index].z === route[index - 1].z || index === 1 || index === route.length - 1, 'street legs are straight')
  }
  assert.deepEqual(routeBetween(a, a), [a])
})

test('walking along a route is continuous and clamped', () => {
  const route = routeBetween({ x: 0, z: 0 }, { x: 20, z: 0 })
  assert.ok(routeLength(route) > 20)
  assert.deepEqual({ x: pointAt(route, 0).x, z: pointAt(route, 0).z }, { x: 0, z: 0 })
  assert.deepEqual({ x: pointAt(route, 1).x, z: pointAt(route, 1).z }, { x: 20, z: 0 })
  assert.deepEqual({ x: pointAt(route, -5).x, z: pointAt(route, -5).z }, { x: 0, z: 0 })
  assert.deepEqual({ x: pointAt(route, 99).x, z: pointAt(route, 99).z }, { x: 20, z: 0 })
  assert.equal(pointAt(route, Number.NaN).x, 0)
  const half = pointAt(route, 0.5)
  assert.ok(Number.isFinite(half.x) && Number.isFinite(half.z) && Number.isFinite(half.heading))
  assert.deepEqual(pointAt([], 0.5), { x: 0, z: 0, heading: 0 })
})

const loan = (id: string, status: ApiLoan['status'], extra: Partial<ApiLoan> = {}): ApiLoan => ({
  loan_id: id,
  lender_id: 'jordan',
  borrower_id: 'avery',
  inventory_id: null,
  catalog_item_id: 'drill',
  request_id: null,
  window: { start: '', end: '' },
  status,
  quantity: 1,
  ...extra,
})

const names = new Map([['drill', 'Drill']])
const housed = new Set(['avery', 'jordan', 'sam'])
const activityOf = (loans: ApiLoan[], handoffs: ApiActivity['handoffs'] = []): ApiActivity => ({ requests: [], loans, handoffs })

test('each loan status becomes the right beacon and trip', () => {
  const scene = sceneFrom(
    activityOf([
      loan('a', 'requested'),
      loan('b', 'confirmed'),
      loan('c', 'picked_up'),
      loan('d', 'picked_up', { due_soon: true }),
      loan('e', 'picked_up', { overdue: true, overdue_minutes: 185 }),
      loan('f', 'returned'),
      loan('g', 'declined'),
    ]),
    housed,
    names,
  )
  assert.deepEqual(scene.beacons.map((beacon) => [beacon.subjectId, beacon.kind, beacon.residentId]), [
    ['a', 'request', 'jordan'],
    ['b', 'ready', 'jordan'],
    ['c', 'out', 'avery'],
    ['d', 'due-soon', 'avery'],
    ['e', 'overdue', 'avery'],
  ])
  assert.equal(scene.beacons[4].label, 'Drill 3 hours overdue')
  assert.deepEqual(scene.trips.map((trip) => [trip.subjectId, trip.fromId, trip.toId, trip.repeat]), [['b', 'avery', 'jordan', true]])
})

test('loans touching someone with no house are not drawn', () => {
  const scene = sceneFrom(activityOf([loan('a', 'confirmed', { lender_id: 'ghost' })]), housed, names)
  assert.deepEqual(scene, { beacons: [], trips: [] })
  assert.deepEqual(sceneFrom(null, housed, names), { beacons: [], trips: [] })
})

test('handoffs show a proposal at the recipient and walkers from each donor once confirmed', () => {
  const allocations = [
    { offer_request_id: 'o1', resident_id: 'jordan', quantity: 1, donor_confirmed: true },
    { offer_request_id: 'o2', resident_id: 'sam', quantity: 1, donor_confirmed: true },
  ]
  const base = { id: 'h1', need_request_id: 'n', recipient_id: 'avery', recipient_confirmed: true, allocations }
  const proposed = sceneFrom(activityOf([], [{ ...base, status: 'proposed' }]), housed, names)
  assert.deepEqual(proposed.beacons.map((beacon) => [beacon.kind, beacon.residentId]), [['request', 'avery']])
  const confirmed = sceneFrom(activityOf([], [{ ...base, status: 'confirmed' }]), housed, names)
  assert.deepEqual(confirmed.trips.map((trip) => trip.fromId), ['jordan', 'sam'])
  assert.deepEqual(sceneFrom(activityOf([], [{ ...base, status: 'received' }]), housed, names), { beacons: [], trips: [] })
})

test('a status change plays one trip, and the first look at the data plays none', () => {
  const before = rememberStatuses(activityOf([loan('a', 'confirmed'), loan('b', 'picked_up'), loan('c', 'requested')]))
  const after = activityOf([loan('a', 'picked_up'), loan('b', 'returned'), loan('c', 'requested'), loan('new', 'confirmed')])
  const trips = tripsForChanges(before, after, housed, names)
  assert.deepEqual(trips.map((trip) => [trip.subjectId, trip.purpose, trip.fromId, trip.toId, trip.repeat]), [
    ['a', 'pickup', 'jordan', 'avery', false],
    ['b', 'return', 'avery', 'jordan', false],
  ])
  assert.deepEqual(tripsForChanges({}, after, housed, names), [])
  assert.deepEqual(tripsForChanges(before, null, housed, names), [])
})

test('KPIs count open and overdue loans and clamp bad values', () => {
  const kpis = kpisFrom(activityOf([loan('a', 'requested'), loan('b', 'picked_up', { overdue: true }), loan('c', 'returned')]), 7.9, 5)
  assert.deepEqual(kpis, { activeLoans: 2, overdue: 1, finished: 7, neighbors: 5 })
  assert.deepEqual(kpisFrom(null, Number.NaN, 0), { activeLoans: 0, overdue: 0, finished: 0, neighbors: 0 })
  assert.equal(kpisFrom(null, -3, 0).finished, 0)
})

test('the tracker knows each step', () => {
  assert.deepEqual(['requested', 'confirmed', 'picked_up', 'returned', 'declined'].map(loanStep), [0, 1, 2, 3, -1])
})

import { describe as detailOf, type DescribeContext } from './describe.ts'

const residentMap = new Map(people.map((resident) => [resident.id, resident]))
const contextFor = (activity: ApiActivity | null, extra: Partial<DescribeContext> = {}): DescribeContext => ({
  residents: residentMap,
  activity,
  names,
  groupBuys: [],
  finished: 3,
  tripSubjects: new Map([['t-b', 'b']]),
  ...extra,
})

test('a house reports what its owner is lending, borrowing and holding late', () => {
  const activity = activityOf([
    loan('a', 'picked_up', { overdue: true, overdue_minutes: 90 }),
    loan('b', 'confirmed', { lender_id: 'avery', borrower_id: 'sam' }),
    loan('c', 'returned'),
  ])
  const avery = detailOf('h:avery', contextFor(activity))!
  assert.equal(avery.title, 'AVERY')
  assert.equal(avery.subtitle, '0 Willow Court, Charlotte')
  assert.deepEqual(Object.fromEntries(avery.rows), { 'Lending out': '1', Borrowing: '1', Overdue: '1', 'Has on loan': 'Drill' })
  assert.equal(Object.fromEntries(detailOf('h:sam', contextFor(activity))!.rows)['Has on loan'], 'Nothing')
})

test('a loan reports its status, people, and how late it is, and drives the tracker', () => {
  const activity = activityOf([loan('b', 'picked_up', { overdue: true, overdue_minutes: 185 })])
  const detail = detailOf('s:b', contextFor(activity))!
  assert.equal(detail.title, 'Drill')
  assert.equal(detail.subtitle, 'JORDAN → AVERY')
  assert.deepEqual(detail.loan, { status: 'picked_up', step: 2, overdue: true })
  assert.equal(Object.fromEntries(detail.rows)['Overdue by'], '3 hours')
  // A walking trip resolves to its loan.
  assert.equal(detailOf('t:t-b', contextFor(activity))!.title, 'Drill')
})

test('handoffs, the hub and the garden are described', () => {
  const handoff = { id: 'h1', need_request_id: 'n', recipient_id: 'avery', recipient_confirmed: true, status: 'confirmed' as const, allocations: [{ offer_request_id: 'o', resident_id: 'jordan', quantity: 1, donor_confirmed: true }] }
  const activity = activityOf([], [handoff])
  assert.deepEqual(Object.fromEntries(detailOf('s:h1', contextFor(activity))!.rows), { Status: 'Confirmed', From: 'JORDAN', To: 'AVERY' })
  const hub = detailOf('hub', contextFor(null, { groupBuys: [{ catalog_item_id: 'level', name: 'Level', members: [{ resident_id: 'sam', name: 'Sam', initials: 'SO' }], member_share_cents: 1000 }] }))!
  assert.deepEqual(hub.rows, [['Exchanges finished', '3'], ['Level', '1 neighbor']])
  assert.deepEqual(detailOf('hub', contextFor(null))!.rows[1], ['Group buys', 'None started'])
  assert.equal(detailOf('park', contextFor(null, { finished: 99 }))!.rows[0][1], '60')
})

test('selections that no longer exist describe nothing instead of crashing', () => {
  const none = contextFor(activityOf([]))
  for (const id of [null, 'h:ghost', 's:gone', 't:t-unknown', 'weird', '']) assert.equal(detailOf(id, none), null)
})
