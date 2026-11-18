import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveSampleListingsOn } from './sampleListings.ts'

test('explicit on wins even with real neighbors', () => {
  assert.equal(resolveSampleListingsOn(true, true), true)
})

test('explicit off wins even when alone', () => {
  assert.equal(resolveSampleListingsOn(false, false), false)
})

test('auto is on only when there are no real neighbors', () => {
  assert.equal(resolveSampleListingsOn(null, false), true)
  assert.equal(resolveSampleListingsOn(null, true), false)
})
