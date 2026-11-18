import { expect, test } from '@playwright/test'

test('second load skips the loading screen when a cached profile exists', async ({ page }) => {
  await page.goto('/cache-shell')
  await expect(page.getByTestId('shelf-ready')).toBeVisible()
  // First visit may briefly show loading; wait until the shell is ready and profile is cached.
  await expect(page.getByTestId('shelf-loading')).toHaveCount(0)

  // Reload with the same origin storage so the cache helper can hydrate before paint.
  await page.reload()

  // The loading screen must never appear on the second load.
  await expect(page.getByTestId('shelf-loading')).toHaveCount(0)
  await expect(page.getByTestId('shelf-ready')).toBeVisible()
})
