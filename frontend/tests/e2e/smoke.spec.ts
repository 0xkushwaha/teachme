import { expect, test } from '@playwright/test';

/** Public pages render real data, have no horizontal overflow, and protect dashboards. Runs on desktop and mobile. */
test('public pages render and are responsive', async ({ page }) => {
  for (const path of ['/', '/subjects', '/teachers', '/teachers/meera-iyer', '/pricing', '/faq', '/legal/cancellation']) {
    await page.goto(path);
    await expect(page.locator('main h1').first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1);
  }
});

test('dashboards redirect anonymous visitors to login', async ({ page }) => {
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin/);
});

test('unknown routes show a helpful 404', async ({ page }) => {
  await page.goto('/this-does-not-exist');
  await expect(page.getByRole('heading', { name: 'This page doesn’t exist' })).toBeVisible();
});
