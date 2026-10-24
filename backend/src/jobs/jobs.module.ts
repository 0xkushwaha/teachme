import { Global, Module } from '@nestjs/common';
import { JobQueueService } from './job-queue.service';
import { JobRecordService } from './job-record.service';

@Global()
@Module({ providers: [JobQueueService, JobRecordService], exports: [JobQueueService, JobRecordService] })
export class JobsModule {}
