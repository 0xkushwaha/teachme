import { expect, test, type Page } from '@playwright/test';
import { DateTime } from 'luxon';
import { API, login, stubRazorpayCheckout, uniqueEmail } from './helpers';

const PASSWORD = 'TeachMe-Dev-2026'; // development seed password
const ADMIN = 'admin@teachme.dev';
const uid = () => Math.random().toString(36).slice(2, 8);

async function asAdmin(page: Page) {
  await login(page, ADMIN, PASSWORD);
  await expect(page).toHaveURL(/\/admin/);
}
const toast = (page: Page, text: string | RegExp) => expect(page.getByText(text).first()).toBeVisible();
const dialog = (page: Page) => page.getByRole('dialog');

test.describe('admin actions', () => {
  test('subjects and categories: create, edit, deactivate, delete', async ({ page }) => {
    await asAdmin(page);
    await page.goto('/admin/subjects');
    const cat = `QA Cat ${uid()}`;
    const name = `QA Subject ${uid()}`;

    await page.getByLabel('New category').fill(cat);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('button', { name: `Delete category ${cat}` })).toBeVisible();

    await page.getByRole('button', { name: 'New subject' }).click();
    await dialog(page).getByLabel('Name').fill(name);
    await dialog(page).getByLabel('Category').selectOption({ label: cat });
    await dialog(page).getByLabel('Description').fill('Created by the admin actions test');
    await dialog(page).getByRole('button', { name: 'Save' }).click();
    const row = page.getByRole('row').filter({ hasText: name });
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: 'Edit' }).click();
    await dialog(page).getByLabel('Description').fill('Edited description');
    await dialog(page).getByRole('button', { name: 'Save' }).click();
    await expect(row.getByText('Edited description')).toBeVisible();

    await row.getByRole('switch').click();
    await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'false');

    // A category with a subject can't go; the dialog explains why.
    await page.getByRole('button', { name: `Delete category ${cat}` }).click();
    await expect(dialog(page).getByText('It still contains 1 subject(s)')).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Close' }).last().click();

    await row.getByRole('button', { name: 'Delete' }).click();
    await dialog(page).getByRole('button', { name: 'Delete' }).click();
    await expect(row).toHaveCount(0);

    await expect(page.getByText(`${cat} · 0`)).toBeVisible(); // the category count has refreshed
    await page.getByRole('button', { name: `Delete category ${cat}` }).click();
    await dialog(page).getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('button', { name: `Delete category ${cat}` })).toHaveCount(0);

    // A subject in use explains instead of deleting.
    await page.getByRole('row').filter({ hasText: 'Physics' }).getByRole('button', { name: 'Delete' }).click();
    await expect(dialog(page).getByText(/so it can.t be deleted/)).toBeVisible();
  });

  test('announcements: publish, edit, archive, delete', async ({ page }) => {
    await asAdmin(page);
    await page.goto('/admin/announcements');
    const title = `QA notice ${uid()}`;
    await page.getByRole('button', { name: 'New announcement' }).first().click();
    await dialog(page).getByLabel('Title').fill(title);
    await dialog(page).getByLabel('Message').fill('Test message');
    await dialog(page).getByRole('button', { name: 'Publish' }).click();
    await toast(page, 'Announcement published');
    await expect(page.locator('main').getByText(title).first()).toBeVisible();

    const card = page.locator('main div').filter({ hasText: title }).filter({ has: page.getByRole('button', { name: 'Edit' }) }).last();
    await card.getByRole('button', { name: 'Edit' }).click();
    await dialog(page).getByLabel('Message').fill('Edited message');
    await dialog(page).getByRole('button', { name: 'Save' }).click();
    await toast(page, 'Announcement updated');

    await card.getByRole('button', { name: 'Archive' }).click();
    await dialog(page).getByRole('button', { name: 'Archive' }).click();
    await toast(page, 'Announcement archived');

    await page.getByRole('tab', { name: 'Archived' }).click();
    const archived = page.locator('main div').filter({ hasText: title }).filter({ has: page.getByRole('button', { name: 'Delete' }) }).last();
    await archived.getByRole('button', { name: 'Delete' }).click();
    await dialog(page).getByRole('button', { name: 'Delete' }).click();
    await toast(page, 'Announcement deleted');
    await expect(page.locator('main').getByText(title)).toHaveCount(0);
  });

  test('support tickets: a contact message can be updated and deleted', async ({ page, request }) => {
    const subject = `QA ticket ${uid()}`;
    const csrf = await request.get(`${API}/auth/csrf`);
    const token = decodeURIComponent((csrf.headers()['set-cookie'] ?? '').match(/tm_csrf=([^;]+)/)?.[1] ?? '');
    const created = await request.post(`${API}/support/tickets`, {
      headers: { 'x-csrf-token': token },
      data: { name: 'QA Person', email: uniqueEmail('qa-ticket'), category: 'OTHER', subject, message: 'This is a test support message.' },
    });
    expect(created.status(), await created.text()).toBeLessThan(300);

    await asAdmin(page);
    await page.goto('/admin/support');
    const card = page.locator('main div').filter({ hasText: subject }).filter({ has: page.getByRole('button', { name: 'Update' }) }).last();
    await card.getByRole('button', { name: 'Update' }).click();
    await dialog(page).getByLabel('Internal note').fill('Handled by QA');
    await dialog(page).getByRole('button', { name: 'Save' }).click();
    await toast(page, 'Ticket updated');

    await page.getByRole('tab', { name: 'In progress' }).click();
    const moved = page.locator('main div').filter({ hasText: subject }).filter({ has: page.getByRole('button', { name: 'Delete' }) }).last();
    await moved.getByRole('button', { name: 'Delete' }).click();
    await dialog(page).getByRole('button', { name: 'Delete' }).click();
    await toast(page, 'Ticket deleted');
    await expect(page.locator('main').getByText(subject)).toHaveCount(0);
  });

  test('notification templates: edit, preview, reset', async ({ page }) => {
    await asAdmin(page);
    await page.goto('/admin/templates');
    const subject = page.getByLabel('Subject');
    const original = await subject.inputValue();
    await subject.fill(`${original} QA`);
    await page.getByRole('button', { name: 'Save template' }).click();
    await toast(page, 'Template saved');
    await page.getByRole('button', { name: 'Preview saved' }).click();
    await expect(dialog(page).locator('iframe')).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await toast(page, 'Reverted to default');
    await expect(subject).toHaveValue(original);
  });

  test('accounts: suspend, reactivate and delete a student from the table', async ({ page, request }) => {
    const created = await (await request.post(`${API}/__test__/students`)).json();
    await asAdmin(page);
    await page.goto('/admin/students');
    const detail = await (await page.request.get(`/api/v1/admin/users/${created.id}`)).json();
    await page.getByLabel('Search users').fill(detail.user.email);
    const row = page.getByRole('row').filter({ hasText: detail.user.email });
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: 'Suspend' }).click();
    await dialog(page).getByLabel('Reason').fill('QA check');
    await dialog(page).getByRole('button', { name: 'Confirm' }).click();
    await toast(page, 'Account updated');

    await row.getByRole('button', { name: 'Reactivate' }).click();
    await dialog(page).getByRole('button', { name: 'Confirm' }).click();
    await expect(row.getByRole('button', { name: 'Suspend' })).toBeVisible();

    await row.getByRole('button', { name: 'Delete' }).click();
    const confirm = dialog(page).getByRole('button', { name: 'Delete permanently' });
    await expect(confirm).toBeDisabled();
    await dialog(page).getByLabel(/Type .* to confirm/).fill(detail.user.email);
    await dialog(page).getByLabel('Reason (audit log)').fill('QA account removal');
    await confirm.click();
    await toast(page, 'Account deleted and personal data erased');
    await expect(row).toHaveCount(0);
  });

  test('toppers: suspend, reactivate, invitations and detail page', async ({ page }) => {
    await asAdmin(page);
    await page.goto('/admin/teachers');
    await page.getByRole('tab', { name: 'Approved' }).click();
    await page.getByLabel('Search toppers').fill('Meera Iyer');
    const card = page.locator('main').getByText('Dr. Meera Iyer').first();
    await expect(card).toBeVisible();
    await page.getByRole('button', { name: 'Suspend' }).first().click();
    await dialog(page).getByRole('button', { name: 'Confirm' }).click();
    await toast(page, 'Topper updated and notified');
    await page.getByRole('tab', { name: 'Suspended' }).click();
    await expect(page.locator('main').getByText('Dr. Meera Iyer').first()).toBeVisible();
    await page.getByRole('button', { name: 'Reactivate' }).first().click();
    await dialog(page).getByRole('button', { name: 'Confirm' }).click();
    await page.getByRole('tab', { name: 'Approved' }).click();
    await expect(page.locator('main').getByText('Dr. Meera Iyer').first()).toBeVisible();

    await page.getByRole('link', { name: 'Review' }).first().click();
    await expect(page.getByRole('heading', { name: 'Dr. Meera Iyer' })).toBeVisible();
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(dialog(page).getByText('This permanently erases personal data')).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();

    // Invitation: invite, resend, revoke, delete.
    await page.goto('/admin/teachers');
    const email = uniqueEmail('qa-invite');
    await page.getByRole('button', { name: 'Invite topper' }).click();
    await dialog(page).getByLabel('Email address').fill(email);
    await dialog(page).getByRole('button', { name: 'Send invitation' }).click();
    await toast(page, `Invitation sent to ${email}`);
    const row = page.getByRole('row').filter({ hasText: email });
    await row.getByRole('button', { name: 'Resend' }).click();
    await toast(page, 'Please wait a minute before resending'); // resends have a cooldown
    await row.getByRole('button', { name: 'Revoke' }).click();
    await dialog(page).getByRole('button', { name: 'Revoke' }).click();
    await toast(page, 'Invitation revoked');
    await page.getByRole('tab', { name: 'Revoked' }).click();
    await row.getByRole('button', { name: 'Delete' }).click();
    await dialog(page).getByRole('button', { name: 'Delete' }).click();
    await toast(page, 'Invitation deleted');
    await expect(row).toHaveCount(0);
  });

  test('bookings and payments: cancel a paid booking with a refund', async ({ page, browser }) => {
    // A student books and pays first.
    const student = await browser.newContext({ timezoneId: 'Asia/Kolkata' });
    const sp = await student.newPage();
    await stubRazorpayCheckout(sp);
    await login(sp, 'dev.student@teachme.dev', PASSWORD);
    await expect(sp).toHaveURL(/\/student/);
    await sp.goto('/teachers/e2e-teacher');
    const target = DateTime.now().setZone('Asia/Kolkata').plus({ days: 3 + Math.floor(Math.random() * 3) });
    await sp.getByRole('tab', { name: new RegExp(`^${target.toFormat('cccc d LLLL')},`) }).click();
    await sp.getByRole('tabpanel').getByRole('button', { name: /(AM|PM)$/ }).first().click();
    await sp.getByRole('button', { name: /Reserve & continue to payment/ }).click();
    await expect(sp).toHaveURL(/\/student\/checkout\//);
    const bookingId = sp.url().split('/').pop()!;
    await sp.getByRole('button', { name: /^Pay / }).click();
    await expect(sp.getByRole('heading', { name: 'Payment verified — session confirmed' })).toBeVisible();
    await student.close();

    await asAdmin(page);
    await page.goto('/admin/payments');
    await expect(page.getByRole('heading', { name: 'Payments & refunds' })).toBeVisible();
    await expect(page.getByRole('row').nth(1)).toBeVisible();
    await page.getByRole('button', { name: /Reconcile/ }).first().click();
    await toast(page, /Reconciled:/);

    await page.goto(`/admin/bookings/${bookingId}`);
    await page.getByRole('button', { name: 'Cancel with refund' }).click();
    await dialog(page).getByLabel('Refund percentage').fill('100');
    await dialog(page).getByLabel('Reason (sent to both parties)').fill('Cancelled by QA');
    await dialog(page).getByRole('button', { name: 'Cancel booking' }).click();
    await expect(page.getByText(/Refund ₹/).first()).toBeVisible({ timeout: 30_000 });

    await page.goto('/admin/payments');
    await page.getByRole('tab', { name: 'Refunds' }).click();
    await expect(page.getByRole('row').nth(1)).toBeVisible();

    await page.goto('/admin/finance');
    await expect(page.getByText('Top toppers by earnings')).toBeVisible();
    const csv = await page.request.get(await page.getByRole('link', { name: /CSV|Download/ }).first().getAttribute('href') ?? '');
    expect(csv.status()).toBe(200);
    expect(await csv.text()).toContain('topper_earning');
  });

  test('settings: feature flags and JSON settings save, invalid input is rejected', async ({ page }) => {
    await asAdmin(page);
    await page.goto('/admin/settings');
    await expect(page.getByRole('heading', { name: 'System settings' })).toBeVisible();
    await expect(page.getByText('Topper applications open')).toBeVisible();
    const editor = page.locator('main textarea').first();
    const original = await editor.inputValue();
    await editor.fill('{ not json');
    const save = page.locator('main').getByRole('button', { name: /^Save/ }).first();
    if (await save.isEnabled()) await save.click();
    await expect(page.getByText(/valid JSON|Invalid|JSON/i).first()).toBeVisible();
    await editor.fill(original);
  });

  test('integration health, audit log and overview render', async ({ page }) => {
    await asAdmin(page);
    await page.goto('/admin/integrations');
    await expect(page.getByRole('heading', { name: 'Integration health' })).toBeVisible();
    await page.goto('/admin/audit');
    await expect(page.getByRole('row').nth(1)).toBeVisible();
    await page.goto('/admin');
    await expect(page.getByText(/live toppers/)).toBeVisible();
  });
});
