import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end stack (isolated from local dev):
 *   backend  → test-only server on :4100 (teachme_e2e DB, fake Razorpay/Google HTTP, real SMTP→Mailpit)
 *   frontend → Next.js on :3100 proxying /api to :4100
 * Prerequisite: `docker compose -f infrastructure/docker-compose.yml up -d postgres redis mailpit`.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    timezoneId: 'Asia/Kolkata',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] }, testMatch: /smoke\.spec\.ts/ },
  ],
  webServer: [
    {
      command: 'npx ts-node --transpile-only test/e2e/e2e-server.ts',
      cwd: '../backend',
      url: 'http://localhost:4100/api/v1/health/ready',
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
    },
    {
      command: 'npx next dev -p 3100',
      url: 'http://localhost:3100',
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: { BACKEND_INTERNAL_URL: 'http://localhost:4100', NEXT_DIST_DIR: '.next-e2e', NEXT_PUBLIC_APP_URL: 'http://localhost:3100' },
    },
  ],
});
