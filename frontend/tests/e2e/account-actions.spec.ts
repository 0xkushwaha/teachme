import { expect, test } from '@playwright/test';
import { login } from './helpers';

const PASSWORD = 'TeachMe-Dev-2026'; // development seed password
const toast = (page: import('@playwright/test').Page, text: string | RegExp) => expect(page.getByText(text).first()).toBeVisible();

test('student: profile and learning profile save and persist', async ({ page }) => {
  await login(page, 'maya.student@teachme.dev', PASSWORD);
  await expect(page).toHaveURL(/\/student/);
  await page.goto('/student/settings');

  const phone = page.getByLabel('Phone (optional)');
  await phone.fill('+919876543210');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await toast(page, 'Profile saved');

  const goal = `Goal ${Date.now()}`;
  await page.getByLabel('Goals').fill(goal);
  await page.locator('form').filter({ has: page.getByLabel('Goals') }).getByRole('button').last().click();
  await toast(page, /saved/i);
  await page.reload();
  await expect(page.getByLabel('Goals')).toHaveValue(goal);
  await expect(page.getByLabel('Phone (optional)')).toHaveValue('+919876543210');

  await page.goto('/student/notifications');
  await expect(page.locator('main h1')).toBeVisible();
});

test('topper: profile, availability and earnings', async ({ page }) => {
  await login(page, 'arjun.mehta@teachme.dev', PASSWORD);
  await expect(page).toHaveURL(/\/teacher/);

  await page.goto('/teacher/profile');
  const headline = page.getByLabel('Headline');
  const edited = `Topper headline ${Date.now()}`;
  await headline.fill(edited);
  await page.locator('main').getByRole('button', { name: /^Save/ }).first().click();
  await toast(page, 'Profile saved');
  await page.reload();
  await expect(page.getByLabel('Headline')).toHaveValue(edited);

  await page.goto('/teacher/availability');
  await page.getByLabel('Buffer between sessions').selectOption({ index: 1 });
  await page.locator('main').getByRole('button', { name: /Save.*rules|Save rules|Save/ }).last().click();
  await toast(page, /saved/i);

  await page.goto('/teacher/earnings');
  await expect(page.getByText('Available to withdraw')).toBeVisible();
  await expect(page.getByRole('button', { name: /Request payout/ })).toBeVisible();
});
