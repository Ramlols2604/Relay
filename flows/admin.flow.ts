import { expect, test } from '@playwright/test'
import { api, confirmedLoan, post } from './helpers.ts'

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept())
})

const tab = (page: import('@playwright/test').Page, name: string) => page.getByRole('tab', { name, exact: true }).click()

test('overview shows real totals and which services are missing', async ({ page, request }) => {
  await confirmedLoan(request, 'level', 'sam', 'jordan')
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Manage Relay' })).toBeVisible()
  await expect(page.locator('.admin-stats li', { hasText: 'loans' }).first()).toBeVisible()
  const stats = await page.locator('.admin-stats li').allInnerTexts()
  expect(stats.join('|')).toMatch(/residents/i)

  const snowflake = page.locator('.admin-row', { hasText: 'Snowflake' })
  await expect(snowflake.getByText('Missing')).toBeVisible()
  await expect(page.getByText('Sign-in is not enforced')).toBeVisible()
})

test('editing a person is saved, searchable, and audited', async ({ page, request }) => {
  const before = (await (await request.get(`${api}/api/admin/residents?q=jordan`)).json()) as { id: string; city: string }[]
  const originalCity = before.find((person) => person.id === 'jordan')!.city
  // Loans only work within one city, so put Jordan back when this test is done.
  test.info().annotations.push({ type: 'restores', description: `jordan city -> ${originalCity}` })
  try {
    await editPerson(page, request)
  } finally {
    await request.patch(`${api}/api/admin/residents/jordan`, { data: { city: originalCity } })
  }
})

async function editPerson(page: import('@playwright/test').Page, request: import('@playwright/test').APIRequestContext) {
  await page.goto('/admin?tab=people')
  await page.getByLabel('Search people').fill('jordan')
  const row = page.locator('.admin-row', { hasText: 'Jordan' }).first()
  await row.getByRole('button', { name: 'Edit' }).click()
  await page.getByLabel('City').fill('Raleigh')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.admin-row', { hasText: 'Raleigh' })).toBeVisible()

  const saved = (await (await request.get(`${api}/api/admin/residents?q=raleigh`)).json()) as { id: string }[]
  expect(saved.map((person) => person.id)).toContain('jordan')

  await page.getByLabel('Search people').fill('zzz-nobody')
  await expect(page.getByText('No one matches.')).toBeVisible()

  await tab(page, 'Audit log')
  await expect(page.locator('.admin-row', { hasText: 'Edited a resident (jordan)' }).first()).toContainText('city: Raleigh')
}

test('a person with loan history cannot be removed, and the reason is shown', async ({ page }) => {
  await page.goto('/admin?tab=people')
  await page.getByLabel('Search people').fill('jordan')
  await page.locator('.admin-row', { hasText: 'Jordan' }).first().getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByRole('alert')).toContainText('loans or handoffs on record')
})

test('cancelling a loan updates its status everywhere', async ({ page, request }) => {
  const loanId = await confirmedLoan(request, 'sander', 'sam', 'jordan')
  await page.goto('/admin?tab=loans')
  const row = page.locator('.admin-row', { hasText: loanId })
  await expect(row).toContainText('confirmed')
  await row.getByRole('button', { name: 'Cancel' }).click()
  await expect(row).toContainText('declined')
  await expect(row.getByRole('button', { name: 'Cancel' })).toHaveCount(0)

  await page.getByLabel('Status').selectOption('declined')
  await expect(page.locator('.admin-row', { hasText: loanId })).toBeVisible()
  const loans = (await (await request.get(`${api}/api/activity`)).json()).loans as { loan_id: string; status: string }[]
  expect(loans.find((loan) => loan.loan_id === loanId)?.status).toBe('declined')
})

test('catalog edits validate, save, and reach the public catalog', async ({ page, request }) => {
  await page.goto('/admin?tab=catalog')
  const row = page.locator('.admin-row', { hasText: 'clamps' })
  const price = row.getByLabel('Price ($)')
  await price.fill('12.345')
  await expect(row.getByText('Enter a name, a price like 60.00')).toBeVisible()
  await expect(row.getByRole('button', { name: 'Save' })).toBeDisabled()

  await price.fill('12.50')
  await row.getByRole('button', { name: 'Save' }).click()
  await expect
    .poll(async () => {
      const catalog = (await (await request.get(`${api}/api/catalog`)).json()) as { id: string; demo_price_cents: number }[]
      return catalog.find((item) => item.id === 'clamps')?.demo_price_cents
    })
    .toBe(1250)
})

test('closing a group buy removes it and its members', async ({ page, request }) => {
  await post(request, '/api/shared-demand/sander/group-buy', { resident_id: 'sam' })
  await post(request, '/api/shared-demand/sander/group-buy/join', { resident_id: 'jordan' })
  await page.goto('/admin?tab=groupbuys')
  const row = page.locator('.admin-row', { hasText: 'Sander' })
  await expect(row).toContainText('2 members')
  await row.getByRole('button', { name: 'Close' }).click()
  await expect(page.locator('.admin-row', { hasText: 'Sander' })).toHaveCount(0)
  const shared = await (await request.get(`${api}/api/shared-demand`)).json()
  expect(shared.group_buys.find((buy: { catalog_item_id: string }) => buy.catalog_item_id === 'sander')).toBeUndefined()
})
