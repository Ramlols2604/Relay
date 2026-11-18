import assert from 'node:assert/strict'
import test from 'node:test'
import { demoCommunityLabel, placeLabel } from './index.ts'

test('real account shows street · city', () => {
  assert.equal(placeLabel('100 Main St', 'Cary', true), '100 Main St · Cary')
})

test('missing street shows just the city', () => {
  assert.equal(placeLabel('', 'Cary', true), 'Cary')
  assert.equal(placeLabel('   ', 'Cary', true), 'Cary')
})

test('demo mode shows the demo label', () => {
  assert.equal(placeLabel('', '', false), demoCommunityLabel)
  assert.equal(placeLabel('14 Willow Court', 'Charlotte', false), demoCommunityLabel)
})
