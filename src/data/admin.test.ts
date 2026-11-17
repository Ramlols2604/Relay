import assert from 'node:assert/strict'
import test from 'node:test'
import type { AdminOverview } from '../api/types.ts'
import { auditSummary, centsFromInput, dollars, integrationRows, parseTab } from './admin.ts'

test('unknown or missing tabs fall back to overview', () => {
  assert.equal(parseTab('audit'), 'audit')
  assert.equal(parseTab('nope'), 'overview')
  assert.equal(parseTab(null), 'overview')
})

test('money formats and parses without float surprises', () => {
  assert.equal(dollars(6000), '$60.00')
  assert.equal(dollars(5), '$0.05')
  assert.equal(dollars(Number.NaN), '$0.00')
  assert.equal(centsFromInput('12.50'), 1250)
  assert.equal(centsFromInput('$12'), 1200)
  assert.equal(centsFromInput(' 0.07 '), 7)
  assert.equal(centsFromInput('19.99'), 1999)
  for (const bad of ['', '-1', '1.234', 'abc', '1,000', '1.']) assert.equal(centsFromInput(bad), null)
})

const base: AdminOverview['integrations'] = {
  snowflake: { snowflake: 'not_configured' },
  ollama: { configured: false, model: null },
  gemini: false,
  backboard: false,
  clerk: true,
  admins_configured: 0,
  auth_enforced: true,
}

test('integration rows say what is missing and what is live', () => {
  const rows = integrationRows(base)
  assert.deepEqual(
    rows.map((row) => [row.name, row.state]),
    [
      ['Snowflake', 'missing'],
      ['Ollama (local model)', 'missing'],
      ['Gemini', 'missing'],
      ['Backboard', 'missing'],
      ['Clerk sign-in', 'ok'],
      ['Admin access', 'missing'],
    ],
  )
  const live = integrationRows({
    ...base,
    snowflake: { snowflake: 'ok' },
    ollama: { configured: true, model: 'mistral' },
    gemini: true,
    admins_configured: 2,
  })
  assert.equal(live[0].state, 'ok')
  assert.equal(live[1].note, 'Chat tries mistral first.')
  assert.equal(live[2].state, 'ok')
  assert.equal(live[5].note, '2 admins allowed.')
  const broken = integrationRows({ ...base, snowflake: { snowflake: 'error', snowflake_message: 'bad login' } })
  assert.deepEqual([broken[0].state, broken[0].note], ['error', 'bad login'])
})

test('audit entries read as sentences', () => {
  const text = auditSummary({
    id: '1',
    at: '',
    actor: 'u',
    action: 'catalog.update',
    target_type: 'catalog',
    target_id: 'drill',
    detail: { demo_price_cents: 7500 },
  })
  assert.equal(text, 'Changed a catalog item (drill) · demo price cents: 7500')
  assert.equal(
    auditSummary({ id: '2', at: '', actor: 'u', action: 'weird.thing', target_type: 'x', target_id: 'y', detail: {} }),
    'weird.thing (y)',
  )
})
