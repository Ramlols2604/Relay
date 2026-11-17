import { expect, test, type Page } from '@playwright/test'
import { ageLoan, api, confirmedLoan, post } from './helpers.ts'

type World = {
  entities: () => string[]
  screenOf: (id: string) => { x: number; y: number } | null
}

const entities = (page: Page) => page.evaluate(() => (window as unknown as { __relayWorld: World }).__relayWorld.entities())
const screenOf = (page: Page, id: string) =>
  page.evaluate((target) => (window as unknown as { __relayWorld: World }).__relayWorld.screenOf(target), id)

/** Click where an entity is on screen, the way a person would. */
async function clickEntity(page: Page, id: string) {
  const at = await screenOf(page, id)
  expect(at, `${id} should be on screen`).not.toBeNull()
  const box = (await page.getByTestId('world-canvas').boundingBox())!
  await page.mouse.click(box.x + at!.x, box.y + at!.y)
}

async function canvasBytes(page: Page) {
  return (await page.locator('.world-stage').screenshot()).length
}

let overdueLoan = ''
let waitingLoan = ''

test.beforeAll(async ({ request }) => {
  // One loan walking to pickup, one that is out and three hours late, and one group buy at the hub.
  waitingLoan = await confirmedLoan(request, 'clamps', 'riley', 'avery')
  overdueLoan = await confirmedLoan(request, 'saw', 'jordan', 'avery')
  await post(request, `/api/loans/${overdueLoan}/pickup`)
  ageLoan(overdueLoan, 185)
  await post(request, '/api/shared-demand/tape-measure/group-buy', { resident_id: 'sam' })
})

test('the town is built from real neighbors and draws something', async ({ page }) => {
  await page.goto('/world')
  await expect(page.getByRole('heading', { name: 'Relay World' })).toBeVisible()
  await expect.poll(async () => (await entities(page)).filter((id) => id.startsWith('h:')).length).toBeGreaterThanOrEqual(5)
  const ids = await entities(page)
  for (const expected of ['h:avery', 'h:jordan', 'h:sam', 'h:riley', 'hub', 'park']) expect(ids).toContain(expected)

  const residents = (await (await page.request.get(`${api}/api/residents`)).json()) as { id: string }[]
  expect(residents.map((resident) => resident.id)).toContain('avery')
  // A flat-colored canvas compresses to almost nothing; a lit town with streets and houses does not.
  expect(await canvasBytes(page)).toBeGreaterThan(20_000)
})

test('totals match the API, and the overdue loan raises an alert', async ({ page, request }) => {
  await page.goto('/world')
  const loans = ((await (await request.get(`${api}/api/activity`)).json()).loans ?? []) as { status: string; overdue?: boolean }[]
  const open = loans.filter((loan) => ['requested', 'confirmed', 'picked_up'].includes(loan.status)).length
  const late = loans.filter((loan) => loan.overdue === true).length
  expect(late, 'this file seeded an overdue loan').toBeGreaterThanOrEqual(1)
  await expect(page.locator('.world-kpis li').nth(0).locator('.world-kpi-value')).toHaveText(String(open))
  await expect(page.locator('.world-kpis li').nth(1).locator('.world-kpi-value')).toHaveText(String(late))
  await expect(page.locator('.world-kpi-alert')).toBeVisible()
})

test('clicking a house opens its details and a label follows it', async ({ page }) => {
  await page.goto('/world')
  await expect.poll(async () => (await entities(page)).includes('h:jordan')).toBe(true)
  await clickEntity(page, 'h:jordan')
  const panel = page.getByRole('complementary', { name: 'Details' })
  await expect(panel.getByRole('heading', { name: 'Jordan Lee' })).toBeVisible()
  await expect(page.locator('.world-label')).toBeVisible()
  await expect(page.locator('.world-label')).toHaveText('Jordan Lee')
  // Clicking it again clears the selection.
  await clickEntity(page, 'h:jordan')
  await expect(panel.getByText('Click a house, a walker or the hub')).toBeVisible()
})

test('the overdue loan can be opened from the town, with its tracker', async ({ page }) => {
  await page.goto('/world')
  await expect.poll(async () => (await entities(page)).includes(`s:${overdueLoan}`)).toBe(true)
  await clickEntity(page, `s:${overdueLoan}`)
  const panel = page.getByRole('complementary', { name: 'Details' })
  await expect(panel.getByRole('heading', { name: 'Saw' })).toBeVisible()
  await expect(panel).toContainText('Overdue by')
  await expect(panel).toContainText('3 hours')
  await expect(panel.locator('.status-step-active')).toContainText('Picked up')
})

test('a neighbor walks to pick up a confirmed loan', async ({ page }) => {
  await page.goto('/world')
  const walker = `t:t-${waitingLoan}`
  await expect.poll(async () => (await entities(page)).includes(walker)).toBe(true)
  const seen = new Set<string>()
  for (let i = 0; i < 6; i++) {
    const at = await screenOf(page, walker)
    seen.add(`${Math.round(at!.x)},${Math.round(at!.y)}`)
    await page.waitForTimeout(900)
  }
  expect(seen.size, 'the walker moves').toBeGreaterThan(1)
  await clickEntity(page, walker)
  await expect(page.getByRole('complementary', { name: 'Details' }).getByRole('heading', { name: 'Clamps' })).toBeVisible()
})

test('search, the area switcher and the tables all select things', async ({ page }) => {
  await page.goto('/world')
  await expect.poll(async () => (await entities(page)).includes('h:riley')).toBe(true)
  const panel = page.getByRole('complementary', { name: 'Details' })

  await page.getByLabel('Search the neighborhood').fill('riley')
  await page.getByRole('listbox').getByRole('button', { name: 'Riley Park' }).click()
  await expect(panel.getByRole('heading', { name: 'Riley Park' })).toBeVisible()

  await page.getByRole('tab', { name: 'Neighbors' }).click()
  await page.getByRole('button', { name: /Sam Ortiz/ }).click()
  await expect(panel.getByRole('heading', { name: 'Sam Ortiz' })).toBeVisible()

  await page.getByRole('tab', { name: 'Group buys' }).click()
  await page.getByRole('button', { name: /Tape measure/ }).click()
  await expect(panel.getByRole('heading', { name: 'Relay Hub' })).toBeVisible()
  await expect(panel).toContainText('Tape measure')

  const before = await screenOf(page, 'hub')
  await page.getByLabel('Fly to an area').selectOption({ index: 2 })
  await expect.poll(async () => JSON.stringify(await screenOf(page, 'hub'))).not.toBe(JSON.stringify(before))
})

test('night mode changes the scene', async ({ page }) => {
  await page.goto('/world')
  await expect.poll(async () => (await entities(page)).includes('hub')).toBe(true)
  const day = await page.locator('.world-stage').screenshot()
  await page.getByRole('button', { name: 'Night' }).click()
  await expect(page.locator('.world')).toHaveClass(/world-night/)
  await page.waitForTimeout(400)
  const night = await page.locator('.world-stage').screenshot()
  expect(Buffer.compare(day, night)).not.toBe(0)
  await expect(page.getByRole('button', { name: 'Day' })).toBeVisible()
})

test('a loan changing state sends someone on a one-off trip', async ({ page, request }) => {
  await page.goto('/world')
  await expect.poll(async () => (await entities(page)).includes(`t:t-${waitingLoan}`)).toBe(true)
  // Let the page take its first look at the data, then change the loan underneath it.
  await page.waitForTimeout(1500)
  await post(request, `/api/loans/${waitingLoan}/pickup`)
  await expect.poll(async () => (await entities(page)).some((id) => id.startsWith(`t:o-${waitingLoan}`)), { timeout: 20_000 }).toBe(true)
  // The looping walker is gone because nothing is waiting for pickup any more, and the one-off finishes.
  await expect.poll(async () => (await entities(page)).includes(`t:t-${waitingLoan}`)).toBe(false)
  await expect.poll(async () => (await entities(page)).some((id) => id.startsWith(`t:o-${waitingLoan}`)), { timeout: 30_000 }).toBe(false)
})
