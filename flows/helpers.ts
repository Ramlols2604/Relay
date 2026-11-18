import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { expect, type APIRequestContext } from '@playwright/test'

export const api = 'http://127.0.0.1:8012'
const root = path.resolve(import.meta.dirname, '..')
const python = fs.existsSync(path.join(root, 'backend/.venv/bin/python')) ? '.venv/bin/python' : 'python'

const naive = (date: Date) => date.toISOString().slice(0, 19)
export const inDays = (days: number, hours = 0) => new Date(Date.now() + days * 86_400_000 + hours * 3_600_000)

export function ageLoan(loanId: string, minutesAgo: number) {
  execFileSync(python, ['../flows/age_loan.py', loanId, String(minutesAgo)], {
    cwd: path.join(root, 'backend'),
    env: { ...process.env, DATABASE_URL: 'sqlite:///./flows.db', PYTHONPATH: path.join(root, 'backend') },
  })
}

export async function post(request: APIRequestContext, url: string, data?: unknown, status = 200) {
  const response = await request.post(`${api}${url}`, { data })
  expect(response.status(), `${url}: ${await response.text()}`).toBe(status)
  return response.json()
}

let loanWindowSlot = 0

/** A confirmed loan of `item` from `lender` to `borrower`, due two days from now. */
export async function confirmedLoan(request: APIRequestContext, item: string, lender: string, borrower: string) {
  const name = item[0].toUpperCase() + item.slice(1)
  const shelf = await shelfItem(request, lender, name)
  // Stagger windows so a retried beforeAll does not collide with loans left in the same DB.
  const hours = (loanWindowSlot++ % 24) * 3
  const loan = await post(
    request,
    '/api/loans',
    {
      borrower_id: borrower,
      lender_id: lender,
      catalog_item_id: item,
      inventory_id: shelf.inventory_id,
      window_start: naive(inDays(2, hours)),
      window_end: naive(inDays(2, hours + 2)),
    },
    201,
  )
  await post(request, `/api/loans/${loan.loan_id}/respond`, { action: 'accept' })
  return loan.loan_id as string
}


/** The lender's shelf entry for `name`, created if it is not there yet (so a retried test does not fail). */
async function shelfItem(request: APIRequestContext, lender: string, name: string) {
  const created = await request.post(`${api}/api/inventory`, {
    data: { resident_id: lender, name, category: 'Tools', quantity: 1, condition: 'Good', notes: '', available_to_lend: true },
  })
  if (created.status() === 201) return (await created.json()) as { inventory_id: string }
  expect(created.status(), await created.text()).toBe(409)
  const listed = (await (await request.get(`${api}/api/inventory?resident_id=${lender}`)).json()) as {
    items: { inventory_id: string; catalog_item: string; resident_id: string }[]
  }
  const found = listed.items.find((row) => row.resident_id === lender && row.catalog_item.toLowerCase() === name.toLowerCase())
  expect(found, `${lender} should already have ${name}`).toBeTruthy()
  return { inventory_id: found!.inventory_id }
}
