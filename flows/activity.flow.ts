import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { ageLoan, api, confirmedLoan, post } from './helpers.ts'

const card = (page: Page, title: string) => page.locator('article.activity-card', { hasText: title })
const gardenCount = async (request: APIRequestContext) =>
  ((await (await request.get(`${api}/api/garden`)).json()) as { count: number }).count

test('borrow, pick up, go overdue, return: the tally and badges follow', async ({ page, request }) => {
  const before = await gardenCount(request)
  await confirmedLoan(request, 'drill', 'jordan', 'avery')
  await page.goto('/')

  const drill = card(page, 'Drill')
  await expect(drill.locator('.status-badge')).toHaveText('Confirmed')
  await expect(page.getByText('overdue', { exact: false }).first()).not.toBeVisible()
  await drill.getByRole('button', { name: 'Mark picked up' }).click()
  await expect(drill.locator('.status-badge')).toHaveText('Picked up')
  await expect(drill.locator('.loan-overdue')).toHaveCount(0)

  // Picked up for two days from now, so nothing is flagged yet. Push the return time into the past.
  const loans = (await (await request.get(`${api}/api/activity`)).json()).loans as { loan_id: string; status: string }[]
  const out = loans.find((loan) => loan.status === 'picked_up')!
  ageLoan(out.loan_id, 185)
  await page.reload()

  await expect(drill.locator('.status-badge')).toHaveText('Overdue')
  await expect(drill.locator('.loan-overdue')).toHaveText('Your drill is 3 hours overdue. Please return it to Jordan.')
  await expect(page.getByText('1 overdue')).toBeVisible()

  await drill.getByRole('button', { name: 'Mark returned' }).click()
  await expect(page.getByText('Nothing active right now')).toBeVisible()
  await expect(page.getByText('overdue', { exact: false }).first()).not.toBeVisible()

  await page.getByRole('button', { name: /Completed/ }).click()
  await expect(card(page, 'Drill').getByText('Loan completed')).toBeVisible()

  expect(await gardenCount(request)).toBe(before + 1)
  await page.reload()
  await expect(page.locator('.garden-tile-value')).toHaveText(String(before + 1))
})

test('the lender sees who still has their tool', async ({ page, request }) => {
  const loanId = await confirmedLoan(request, 'saw', 'avery', 'sam')
  await post(request, `/api/loans/${loanId}/pickup`)
  ageLoan(loanId, 3000)
  await page.goto('/')

  const saw = card(page, 'Saw')
  await expect(saw.locator('.status-badge')).toHaveText('Overdue')
  await expect(saw.locator('.loan-overdue')).toHaveText('Sam still has your saw. It was due back 2 days ago.')
  // Overdue loans are listed first.
  await expect(page.locator('article.activity-card').first()).toContainText('Saw')
})

test('a group buy can be joined, left, and survives a reload', async ({ page, request }) => {
  await post(request, '/api/shared-demand/level/group-buy', { resident_id: 'sam' })
  await page.goto('/')

  const buy = page.locator('.shared-demand li', { hasText: 'Level' })
  await expect(buy).toContainText('1 neighbor in')
  await expect(buy.getByText('Sam Ortiz')).toBeVisible()

  await buy.getByRole('button', { name: 'Join group buy' }).click()
  await expect(buy).toContainText('2 neighbors in')
  await expect(buy.getByText('You', { exact: true })).toBeVisible()
  await page.reload()
  await expect(buy).toContainText('2 neighbors in')

  await buy.getByRole('button', { name: 'Leave group buy' }).click()
  await expect(buy).toContainText('1 neighbor in')
  await expect(buy.getByRole('button', { name: 'Join group buy' })).toBeVisible()

  const shared = await (await request.get(`${api}/api/shared-demand`)).json()
  const level = shared.group_buys.find((row: { catalog_item_id: string }) => row.catalog_item_id === 'level')
  expect(level.members.map((member: { resident_id: string }) => member.resident_id)).toEqual(['sam'])
})
