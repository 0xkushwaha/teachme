import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { TEST_ENV } from './test-env';

/**
 * Prepares the dedicated integration-test database WITHOUT destroying data:
 * creates it if missing and applies pending migrations (`migrate deploy`).
 * Tests create uniquely-named fixtures, so they don't require an empty database.
 */
export default async function globalSetup() {
  const url = new URL(TEST_ENV.DATABASE_URL);
  const dbName = url.pathname.slice(1);
  if (!dbName.endsWith('_test')) throw new Error(`Refusing to run integration tests against non-test database "${dbName}"`);

  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new PrismaClient({ datasources: { db: { url: admin.toString() } } });
  try {
    const exists = await client.$queryRaw<{ n: number }[]>`SELECT 1 AS n FROM pg_database WHERE datname = ${dbName}`;
    if (!exists.length) await client.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await client.$disconnect();
  }

  execSync('npx prisma migrate deploy', { env: { ...process.env, ...TEST_ENV, PRISMA_HIDE_UPDATE_MESSAGE: '1' }, stdio: 'pipe' });
}
