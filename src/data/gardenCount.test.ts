import assert from 'node:assert/strict'
import test from 'node:test'
import { gardenCopy } from './gardenCount.ts'

test('zero, one and many read naturally', () => {
  assert.equal(gardenCopy(0).value, '0')
  assert.match(gardenCopy(0).label, /first one/)
  assert.equal(gardenCopy(1).label, 'exchange finished between neighbors')
  assert.equal(gardenCopy(12).label, 'exchanges finished between neighbors')
})

test('bad values fall back to zero', () => {
  assert.equal(gardenCopy(-3).value, '0')
  assert.equal(gardenCopy(Number.NaN).value, '0')
  assert.equal(gardenCopy(2.9).value, '2')
})
