import assert from 'node:assert/strict'
import test from 'node:test'
import { inventoryQuantityDigits, parseInventoryQuantity } from './inventoryQuantity.ts'

test('digits-only strips letters and symbols', () => {
  assert.equal(inventoryQuantityDigits('12a'), '12')
  assert.equal(inventoryQuantityDigits('3.5'), '35')
  assert.equal(inventoryQuantityDigits(''), '')
  assert.equal(inventoryQuantityDigits('9999'), '999')
})

test('parse accepts whole numbers and clamps to 1-99', () => {
  assert.deepEqual(parseInventoryQuantity('1'), { ok: true, value: 1 })
  assert.deepEqual(parseInventoryQuantity('42'), { ok: true, value: 42 })
  assert.deepEqual(parseInventoryQuantity('0'), { ok: true, value: 1 })
  assert.deepEqual(parseInventoryQuantity('150'), { ok: true, value: 99 })
})

test('parse rejects empty and non-whole values', () => {
  assert.equal(parseInventoryQuantity('').ok, false)
  assert.equal(parseInventoryQuantity('   ').ok, false)
  assert.equal(parseInventoryQuantity('12.5').ok, false)
  assert.equal(parseInventoryQuantity('abc').ok, false)
})
