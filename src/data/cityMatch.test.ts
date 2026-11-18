import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeCityKey, sameCity } from './cityMatch.ts'

test('normalizeCityKey drops case and spaces', () => {
  assert.equal(normalizeCityKey('Charlotte'), 'charlotte')
  assert.equal(normalizeCityKey('charlotte '), 'charlotte')
  assert.equal(normalizeCityKey('  Char Lotte '), 'charlotte')
  assert.equal(normalizeCityKey('Cary'), 'cary')
})

test('sameCity matches charlotte variants and rejects empty or other cities', () => {
  assert.equal(sameCity('Charlotte', 'charlotte '), true)
  assert.equal(sameCity('Char Lotte', 'charlotte'), true)
  assert.equal(sameCity('Cary', 'Charlotte'), false)
  assert.equal(sameCity('', 'Charlotte'), false)
  assert.equal(sameCity('Charlotte', '   '), false)
})
