import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks(); // SIGTERM → workers stop taking jobs and finish active ones
  await app.init();
}

bootstrap().catch((err) => {
  console.error('Fatal: worker failed to start', err);
  process.exit(1);
});
