import { expect, test } from '@playwright/test';
import { DateTime } from 'luxon';
import { API, latestEmail, login, stubRazorpayCheckout, uniqueEmail } from './helpers';

/**
 * The full journey from the specification, in order:
 *  1 register + verify · 2 discover teacher by subject · 3 book a slot · 4 payment verified
 *  5 booking confirmed · 6 calendar + Meet jobs run · 7 confirmation notification recorded
 *  8 reminders scheduled · 9 teacher and student see the booking · 10 student cancels per policy
 *  11 a second student cannot take the same slot
 */
test.describe.serial('student booking journey', () => {
  const email = uniqueEmail('e2e-student');
  const password = 'E2e-Student-Pass1';
  let bookingId = '';
  let slotStart = '';

  test('1. student registers and verifies their email', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('Full name').fill('Riya Sen');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/student$/);
    await expect(page.getByText('Verify your email address')).toBeVisible();

    const text = await latestEmail(email, 'Verify your TeachMe email');
    const link = text.match(/https?:\/\/\S+verify-email\?token=\S+/)?.[0];
    expect(link, 'verification link in email').toBeTruthy();
    await page.goto(link!.replace('http://localhost:3100', ''));
    await expect(page.getByRole('heading', { name: 'Email verified' })).toBeVisible();
  });

  test('2-5. discovers a teacher by subject, books, pays, and gets a verified confirmation', async ({ page }) => {
    await stubRazorpayCheckout(page);
    await login(page, email, password);
    await expect(page).toHaveURL(/\/student/);

    await page.goto('/subjects/physics');
    await expect(page.getByRole('heading', { name: 'Physics teachers' })).toBeVisible();
    await page.getByRole('link', { name: /Ishaan Rao/ }).click();
    await expect(page.getByRole('heading', { name: 'Ishaan Rao' })).toBeVisible();

    // Book 10:00 AM two days out (Asia/Kolkata), so the session is always > 24 h away and step 10
    // exercises the free-cancellation window regardless of when CI runs.
    const target = DateTime.now().setZone('Asia/Kolkata').plus({ days: 2 });
    await page.getByRole('tab', { name: new RegExp(`^${target.toFormat('cccc d LLLL')},`) }).click();
    await page.getByRole('tabpanel').getByRole('button', { name: '10:00 AM', exact: true }).click();
    await expect(page.getByText(`${target.toFormat('cccc, d LLLL')} · 10:00 AM · 60 min`)).toBeVisible();
    await expect(page.getByText('₹1,200', { exact: true })).toBeVisible(); // session price from the live quote
    await page.getByRole('button', { name: /Reserve & continue to payment/ }).click();

    await expect(page).toHaveURL(/\/student\/checkout\//);
    bookingId = page.url().split('/').pop()!;
    await expect(page.getByText('Slot reserved for you')).toBeVisible();
    await page.getByRole('button', { name: /^Pay / }).click();

    await expect(page.getByRole('heading', { name: 'Payment verified — session confirmed' })).toBeVisible();
    const booking = await (await page.request.get(`/api/v1/bookings/${bookingId}`)).json();
    expect(booking.status).toBe('CONFIRMED');
    expect(booking.payment.status).toBe('CAPTURED');
    slotStart = booking.startAt;
  });

  test('6-8. calendar event and Meet link are created, confirmation recorded, reminders scheduled', async ({ page }) => {
    await login(page, email, password, `/student/sessions/${bookingId}`);
    // Meet creation is asynchronous (pending → polled → ready).
    await expect(page.getByText('Google Meet is ready')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('link', { name: 'Join' })).toHaveAttribute('href', /^https:\/\/meet\.google\.com\//);

    const cal = await (await page.request.get(`${API}/__test__/calendar/${bookingId}`)).json();
    expect(cal.exists).toBe(true);
    expect(cal.startIso).toBe(new Date(slotStart).toISOString());

    const email1 = await latestEmail(email, 'Confirmed: Physics with Ishaan Rao');
    expect(email1).toContain('payment of');
    await page.goto('/student/notifications');
    await expect(page.getByText(/Physics with Ishaan Rao on .* is confirmed/)).toBeVisible();

    const reminders = await (await page.request.get(`${API}/__test__/reminders/${bookingId}`)).json();
    const startMs = new Date(slotStart).getTime();
    // Delays are measured from BullMQ's enqueue timestamp, so allow a few seconds of scheduling skew.
    for (const r of reminders) expect(Math.abs(new Date(r.fireAt).getTime() - (startMs - r.offsetMinutes * 60_000))).toBeLessThan(5_000);
    expect(reminders.length).toBeGreaterThan(0);
  });

  test('9. teacher sees the booking with student details', async ({ page }) => {
    await login(page, 'e2e.teacher@teachme.test', 'E2e-Teacher-Pass1', `/teacher/bookings/${bookingId}`);
    await expect(page.getByText('Riya Sen')).toBeVisible();
    await expect(page.getByText('Confirmed', { exact: true })).toBeVisible();
    await page.goto('/teacher/bookings');
    await expect(page.locator(`a[href="/teacher/bookings/${bookingId}"]`)).toHaveText('Physics · Riya Sen');
  });

  test('11. a second student cannot take the same slot', async ({ page, request }) => {
    const rival = await (await request.post(`${API}/__test__/students`)).json();
    const teacher = await (await request.get(`${API}/teachers/e2e-teacher`)).json();
    const res = await request.post(`${API}/bookings`, {
      headers: { Authorization: `Bearer ${rival.token}`, 'Idempotency-Key': `e2e-rival-${Date.now()}` },
      data: { teacherId: teacher.id, subjectId: teacher.subjects[0].id, startAt: slotStart, durationMinutes: 60 },
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).error.code).toBe('SLOT_UNAVAILABLE');
    // …and the slot is no longer offered (the UI renders exactly this list).
    const day = new Date(slotStart);
    const from = new Date(day.getTime() - 12 * 3_600_000).toISOString();
    const to = new Date(day.getTime() + 12 * 3_600_000).toISOString();
    const slots = await (await request.get(`${API}/availability/teachers/${teacher.id}/slots`, { params: { from, to, durationMinutes: 60 } })).json();
    expect(slots.slots.length).toBeGreaterThan(0);
    expect(slots.slots.map((s: { startAt: string }) => s.startAt)).not.toContain(new Date(slotStart).toISOString());
    await page.goto('/teachers/e2e-teacher');
    await expect(page.getByRole('heading', { name: 'Ishaan Rao' })).toBeVisible();
  });

  test('10. student cancels within the free window and gets a full refund', async ({ page }) => {
    await login(page, email, password, `/student/sessions/${bookingId}`);
    await page.getByRole('button', { name: 'Cancel session' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Estimated refund')).toBeVisible();
    await dialog.getByLabel(/Reason/).fill('Exam rescheduled');
    await dialog.getByRole('button', { name: 'Cancel session' }).click();
    await expect(page.getByText(/Cancelled\. Refund of/)).toBeVisible();
    await expect(page.getByText('Cancelled', { exact: true }).first()).toBeVisible();
    // Refund is submitted to the (fake) Razorpay API by the worker.
    await expect.poll(async () => (await (await page.request.get(`/api/v1/bookings/${bookingId}`)).json()).refunds[0]?.status, { timeout: 30_000 }).toBe('SUBMITTED');
    // Calendar event removed.
    await expect.poll(async () => (await (await page.request.get(`${API}/__test__/calendar/${bookingId}`)).json()).cancelled, { timeout: 30_000 }).toBe(true);
  });
});
