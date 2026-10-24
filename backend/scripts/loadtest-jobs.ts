/**
 * Job-processing throughput (DEVELOPMENT/STAGING ONLY): enqueues N email notifications the same
 * way the outbox does, then measures how long the running worker takes to deliver all of them via
 * SMTP (status SENT with a provider message id). Usage: LT_JOBS=1000 ts-node scripts/loadtest-jobs.ts
 */
import '../src/config/load-dotenv';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { writeFileSync } from 'fs';
import { join } from 'path';

const N = Number(process.env.LT_JOBS ?? 1000);
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: 'lt-student-' } }, select: { id: true }, take: N });
  const run = Date.now().toString(36);
  const ids: string[] = [];
  for (let i = 0; i < N; i++) {
    const n = await prisma.notification.create({
      data: {
        userId: users[i % users.length].id,
        type: 'verify_email',
        category: 'ACCOUNT',
        channel: 'EMAIL',
        title: 'Load test',
        body: 'Load test',
        dedupeKey: `lt-jobs.${run}.${i}`,
        data: { context: { user: { name: 'Load' }, link: 'http://localhost:3000/verify-email?token=load-test' } },
      },
    });
    ids.push(n.id);
  }
  const connection = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });
  const queue = new Queue('notifications', { connection });
  const t0 = Date.now();
  await queue.addBulk(ids.map((id) => ({ name: 'email.send', data: { notificationId: id }, opts: { jobId: `lt-email.${id}`, attempts: 6, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: 1000 } })));
  let sent = 0;
  const samples: { s: number; sent: number }[] = [];
  while (sent < N && Date.now() - t0 < 10 * 60_000) {
    await new Promise((r) => setTimeout(r, 1000));
    sent = await prisma.notification.count({ where: { id: { in: ids }, status: 'SENT', providerMessageId: { not: null } } });
    samples.push({ s: Math.round((Date.now() - t0) / 1000), sent });
  }
  const seconds = (Date.now() - t0) / 1000;
  const failed = await prisma.notification.count({ where: { id: { in: ids }, status: 'FAILED' } });
  const result = { jobs: N, delivered: sent, failed, seconds: Number(seconds.toFixed(1)), throughputPerSecond: Number((sent / seconds).toFixed(1)) };
  console.log(JSON.stringify(result));
  writeFileSync(join(__dirname, '..', '..', 'loadtest-results', 'jobs.json'), JSON.stringify({ ...result, samples }, null, 2));
  // Clean up synthetic notifications.
  await prisma.notification.deleteMany({ where: { id: { in: ids } } });
  await queue.close();
  await connection.quit();
}

main().finally(() => prisma.$disconnect());
