import { Module } from '@nestjs/common';
import { loggerModule } from './config/logger';
import { SHARED_IMPORTS, WORKER_PROVIDERS } from './app.module';

/** Background worker process: outbox relay + all queue consumers. No HTTP server. */
@Module({ imports: [loggerModule(), ...SHARED_IMPORTS], providers: WORKER_PROVIDERS })
export class WorkerModule {}
