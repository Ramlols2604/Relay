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

/** A confirmed loan of `item` from `lender` to `borrower`, due two days from now. */
export async function confirmedLoan(request: APIRequestContext, item: string, lender: string, borrower: string) {
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

