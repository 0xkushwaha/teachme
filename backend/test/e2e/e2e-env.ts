/** Isolated environment for the Playwright end-to-end stack (own DB, Redis DB, ports). TEST ONLY. */
export const E2E_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  PORT: '4100',
  APP_URL: 'http://localhost:3100',
  API_URL: 'http://localhost:4100',
  CORS_ORIGINS: 'http://localhost:3100',
  LOG_LEVEL: 'warn',
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'postgresql://teachme:teachme_dev_password@localhost:5432/teachme_e2e?schema=public&connection_limit=20',
  REDIS_URL: process.env.E2E_REDIS_URL ?? 'redis://localhost:6379/2',
  JWT_ACCESS_SECRET: 'e2e-access-secret-that-is-long-enough-1234567',
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
  RAZORPAY_KEY_ID: 'rzp_test_e2efake',
  RAZORPAY_KEY_SECRET: 'e2e_key_secret',
  RAZORPAY_WEBHOOK_SECRET: 'e2e_webhook_secret',
  GOOGLE_CLIENT_ID: 'e2e-client.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'e2e-google-secret',
  GOOGLE_REDIRECT_URI: 'http://localhost:4100/api/v1/integrations/google/callback',
  // Real SMTP delivery to the local Mailpit sink, so tests can read actual emails.
  SMTP_HOST: process.env.E2E_SMTP_HOST ?? 'localhost',
  SMTP_PORT: process.env.E2E_SMTP_PORT ?? '1025',
  THROTTLE_GLOBAL_LIMIT: '100000',
  RUN_WORKERS_IN_API: 'true',
};
