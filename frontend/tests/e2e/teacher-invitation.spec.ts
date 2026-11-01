import { expect, test } from '@playwright/test';
import { API, latestEmail, login, uniqueEmail } from './helpers';

/**
 * Teacher onboarding through the UI: an admin invites by email, the invitation arrives over real
 * SMTP (Mailpit), the teacher accepts it and lands on their application, and the link cannot be reused.
 */
test.describe.serial('teacher invitation journey', () => {
  const adminPassword = 'E2e-Admin-Pass1';
  const teacherEmail = uniqueEmail('e2e-invited-teacher');
  let adminEmail = '';
  let inviteLink = '';

  test('admin invites a teacher from the Teachers page', async ({ page, request }) => {
    adminEmail = (await (await request.post(`${API}/__test__/admins`, { data: { password: adminPassword } })).json()).email;
    await login(page, adminEmail, adminPassword, '/admin/teachers');
    await expect(page.getByRole('heading', { name: 'Teachers' })).toBeVisible();
    await page.getByRole('button', { name: 'Invite teacher' }).click();
    await page.getByLabel('Email address').fill(teacherEmail);
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByText(`Invitation sent to ${teacherEmail.toLowerCase()}`)).toBeVisible();
    await expect(page.getByRole('cell', { name: teacherEmail.toLowerCase() })).toBeVisible();

    const text = await latestEmail(teacherEmail.toLowerCase(), 'invited to teach');
    inviteLink = text.match(/https?:\/\/\S+\/invite\?token=\S+/)?.[0] ?? '';
    expect(inviteLink, 'invitation link in email').toBeTruthy();
  });

  test('the invited teacher creates their account and lands on the application', async ({ page }) => {
    await page.goto(inviteLink.replace(/^https?:\/\/[^/]+/, ''));
    await expect(page.getByRole('heading', { name: 'Join TeachMe as a teacher' })).toBeVisible();
    await expect(page.getByLabel('Email')).toHaveValue(teacherEmail.toLowerCase());
    await page.getByLabel('Full name').fill('Kavya Menon');
    await page.getByLabel('Password').fill('E2e-Teacher-Invite1');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Create teacher account' }).click();

    await expect(page).toHaveURL(/\/teacher\/application/);
    await expect(page.getByRole('heading', { name: 'Application & documents' })).toBeVisible();
    await expect(page.getByText('Verify your email address — done')).toBeAttached();
    await expect(page.getByRole('button', { name: 'Submit application' })).toBeDisabled();
    await latestEmail(teacherEmail.toLowerCase(), 'Welcome to TeachMe');
  });

  test('the invitation link cannot be used twice', async ({ page }) => {
    await page.goto(inviteLink.replace(/^https?:\/\/[^/]+/, ''));
    await expect(page.getByRole('heading', { name: 'Invitation unavailable' })).toBeVisible();
  });

  test('teachers cannot open admin pages and the API refuses them', async ({ page }) => {
    await login(page, teacherEmail.toLowerCase(), 'E2e-Teacher-Invite1');
    await expect(page).toHaveURL(/\/teacher/);
    const res = await page.request.get('/api/v1/admin/invitations');
    expect(res.status()).toBe(403);
  });
});
