import { expect, test } from '@playwright/test'

test('address shell verifies a picked Mapbox suggestion via mocked geocoder', async ({ page }) => {
  // Backend uses MAPBOX_ACCESS_TOKEN=pk.flow-test (stubbed geocoder) from the flows webServer env.
  await page.goto('/address-shell')
  await expect(page.getByTestId('address-shell')).toBeVisible()

  await page.getByTestId('address-city').fill('Cary')
  await page.getByTestId('address-street').fill('100 Main')

  const suggestions = page.getByTestId('address-suggestions')
  await expect(suggestions).toBeVisible({ timeout: 8_000 })
  await suggestions.getByRole('option').first().click()
  await expect(page.getByTestId('address-status')).toContainText('Address verified')

  await page.getByTestId('address-shell-save').click()
  await expect(page.getByTestId('address-shell-saved')).toContainText('verified')
  await expect(page.getByTestId('address-shell-saved')).toContainText('100 Main Street, Cary')
  await expect(page.getByTestId('address-shell-saved')).toContainText('35.7915')
  await expect(page.getByTestId('address-shell-saved')).toContainText('-78.7811')
})

test('address shell blocks demo street and approximate geocoder hits', async ({ page }) => {
  await page.goto('/address-shell')
  await page.getByTestId('address-city').fill('Cary')
  await page.getByTestId('address-street').fill('14 Willow Court')

  await expect(page.getByTestId('address-status')).toContainText('Replace the demo address', {
    timeout: 5_000,
  })
  await page.getByTestId('address-shell-save').click()
  await expect(page.getByTestId('address-shell-error')).toContainText('Replace the demo address')

  await page.getByTestId('address-street').fill('99 Approximate')
  await expect(page.getByTestId('address-status')).toContainText("couldn't find that exact address", {
    timeout: 5_000,
  })
  await expect(page.getByTestId('address-suggestions')).toHaveCount(0)
  await page.getByTestId('address-shell-save').click()
  await expect(page.getByTestId('address-shell-error')).toContainText('Pick an address suggestion')
})
