import assert from 'node:assert/strict'
import test from 'node:test'
import { isMember, orphanGroupBuys } from './groupBuys.ts'
import type { ApiSharedDemand } from '../api/types.ts'

const buy = (id: string) => ({ catalog_item_id: id, name: id, members: [], member_share_cents: null })
const group = (id: string) => ({ catalog_item_id: id }) as ApiSharedDemand['groups'][number]

test('a started buy with no open demand is listed on its own', () => {
  const demand = { snowflake: 'ok', groups: [group('drill')], group_buys: [buy('drill'), buy('saw')] }
  assert.deepEqual(
    orphanGroupBuys(demand).map((b) => b.catalog_item_id),
    ['saw'],
  )
})

test('missing data and older API responses give an empty list', () => {
  assert.deepEqual(orphanGroupBuys(null), [])
  assert.deepEqual(orphanGroupBuys({ snowflake: 'ok', groups: [] } as unknown as ApiSharedDemand), [])
})

test('membership matches by resident id', () => {
  assert.equal(isMember([{ resident_id: 'avery' }], 'avery'), true)
  assert.equal(isMember([{ resident_id: 'avery' }], 'sam'), false)
})
