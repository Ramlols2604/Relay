import assert from 'node:assert/strict'
import test from 'node:test'
import { demoPreviewResidents, worldEmptyCopy } from './demoNeighbors.ts'

test('demo preview residents share the viewer city and skip the viewer id', () => {
  const rows = demoPreviewResidents('demo:jordan', 'Cary')
  assert.ok(rows.every((row) => row.city === 'Cary'))
  assert.ok(!rows.some((row) => row.id === 'demo:jordan'))
  assert.ok(rows.length >= 3)
})

test('empty state copy names the city', () => {
  assert.equal(
    worldEmptyCopy('Cary'),
    "You're the first one in Cary. Invite a neighbor, or preview with demo neighbors.",
  )
  assert.match(worldEmptyCopy('  '), /your city/)
})
