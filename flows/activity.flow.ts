import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const api = 'http://127.0.0.1:8012'
const root = path.resolve(import.meta.dirname, '..')
const python = fs.existsSync(path.join(root, 'backend/.venv/bin/python')) ? '.venv/bin/python' : 'python'

const naive = (date: Date) => date.toISOString().slice(0, 19)
const inDays = (days: number, hours = 0) => new Date(Date.now() + days * 86_400_000 + hours * 3_600_000)

function ageLoan(loanId: string, minutesAgo: number) {
  execFileSync(python, ['../flows/age_loan.py', loanId, String(minutesAgo)], {
    cwd: path.join(root, 'backend'),
    env: { ...process.env, DATABASE_URL: 'sqlite:///./flows.db', PYTHONPATH: path.join(root, 'backend') },
  })
}

async function post(request: APIRequestContext, url: string, data?: unknown, status = 200) {
  const response = await request.post(`${api}${url}`, { data })
  expect(response.status(), `${url}: ${await response.text()}`).toBe(status)
  return response.json()
}

/** A confirmed loan of `item` from `lender` to `borrower`, due two days from now. */
async function confirmedLoan(request: APIRequestContext, item: string, lender: string, borrower: string) {
  const shelf = await post(
    request,
    '/api/inventory',
    {
      resident_id: lender,
      name: item[0].toUpperCase() + item.slice(1),
      category: 'Tools',
      quantity: 1,
      condition: 'Good',
      notes: '',
      available_to_lend: true,
    },
    201,
  )
  const loan = await post(
    request,
    '/api/loans',
    {
      borrower_id: borrower,
      lender_id: lender,
      catalog_item_id: item,
      inventory_id: shelf.inventory_id,
      window_start: naive(inDays(2)),
      window_end: naive(inDays(2, 2)),
    },
    201,
  )
  await post(request, `/api/loans/${loan.loan_id}/respond`, { action: 'accept' })
  return loan.loan_id as string
}

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
