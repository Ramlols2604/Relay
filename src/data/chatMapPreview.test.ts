import assert from 'node:assert/strict'
import test from 'node:test'
import { angleForId, pointsFromDistances } from './chatMapPreview.ts'

test('chat map points are built without any network', () => {
  let fetchCalled = 0
  const original = globalThis.fetch
  globalThis.fetch = (async () => {
    fetchCalled += 1
    return new Response('{}')
  }) as typeof fetch
  try {
    const points = pointsFromDistances([
      { id: 'jordan', label: 'Jordan', distance: 2 },
      { id: 'sam', label: 'Sam', distance: 3 },
    ])
    assert.equal(points[0]?.kind, 'you')
    assert.equal(points.length, 3)
    assert.ok(points.some((point) => point.id === 'jordan' && point.kind === 'lender'))
    assert.equal(fetchCalled, 0)
    assert.notEqual(angleForId('jordan'), angleForId('sam'))
  } finally {
    globalThis.fetch = original
  }
})
