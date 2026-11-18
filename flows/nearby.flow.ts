import { expect, test } from '@playwright/test'
import { post } from './helpers.ts'

const LENDER_ID = 'flow_nearby_lender'

// `world.flow.ts` runs after this file against the same backend and needs Avery back in
// "Charlotte" (it borrows from the seeded Charlotte neighbors, jordan and riley, which only
// works when both residents share a city string). So this file verifies Avery under a
// one-off city name instead: real enough to pass verification, but not "Charlotte" (which
// would let the nearby-lenders search match the load-test "block-*" residents seeded there
// by `_same_city`, regardless of actual distance) — then restores "Charlotte" afterward.
const ORIGIN = { latitude: 35.7915, longitude: -78.7811 } // Cary, NC

test.beforeAll(async ({ request }) => {
  // Avery verifies a real address so the backend can compute distances from it.
  await post(request, '/api/me', {
    clerk_user_id: 'avery',
    name: 'Avery Moss',
    email: 'avery@example.test',
    initials: 'AM',
    street: '100 Main Street',
    city: 'Nearbyville',
    about: '',
    latitude: ORIGIN.latitude,
    longitude: ORIGIN.longitude,
    formatted_address: '100 Main Street, Nearbyville, North Carolina, United States',
    state: 'NC',
  })

  // A verified neighbor nearby, in the same (fictional) city, with a ladder on their shelf.
  await post(request, '/api/me', {
    clerk_user_id: LENDER_ID,
    name: 'Jamie Porter',
    email: 'jamie@example.test',
    initials: 'JP',
    street: '200 Oak Avenue',
    city: 'Nearbyville',
    about: '',
    latitude: ORIGIN.latitude + 0.0015,
    longitude: ORIGIN.longitude + 0.0015,
    formatted_address: '200 Oak Avenue, Nearbyville, North Carolina, United States',
    state: 'NC',
  })
  await post(
    request,
    '/api/inventory',
    {
      resident_id: LENDER_ID,
      name: 'Ladder',
      category: 'Tools',
      quantity: 1,
      condition: 'Good',
      notes: '',
      available_to_lend: true,
    },
    201,
  )
})

test.afterAll(async ({ request }) => {
  // Restore Avery to "Charlotte" for the flow files that run after this one.
  await post(request, '/api/me', {
    clerk_user_id: 'avery',
    name: 'Avery Moss',
    email: 'avery@example.test',
    initials: 'AM',
    street: '100 Main Street',
    city: 'Charlotte',
    about: '',
    latitude: 35.2271,
    longitude: -80.8431,
    formatted_address: '100 Main Street, Charlotte, North Carolina, United States',
    state: 'NC',
  })
})

test('chat finds the closest lender, Avery requests it, and it shows in Activity', async ({ page }) => {
  await page.goto('/chat')
  await page.getByLabel('Message to Relay').fill('I want a ladder, who is the closest with it?')
  await page.getByRole('button', { name: 'Send message' }).click()

  const card = page.locator('.tool-card', { hasText: 'Ladder' })
  await expect(card).toBeVisible()
  await expect(card).toContainText('Jamie P')
  await expect(card.locator('.chat-map-preview')).toBeVisible()

  await card.getByRole('button', { name: 'Request to borrow' }).click()
  await expect(card.getByText('Request sent')).toBeVisible()

  await page.goto('/')
  await expect(page.locator('article.activity-card', { hasText: 'Ladder' })).toBeVisible()
})
