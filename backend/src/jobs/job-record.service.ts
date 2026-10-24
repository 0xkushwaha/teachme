import { Injectable } from '@nestjs/common';
import { JobStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class JobRecordService {
  constructor(private readonly prisma: PrismaService) {}

  async started(key: string, attempt: number) {
    await this.prisma.jobRecord.updateMany({
      where: { jobKey: key },
      data: { status: JobStatus.RUNNING, attempts: attempt, startedAt: new Date() },
    });
  }

  async succeeded(key: string, note?: string) {
    await this.prisma.jobRecord.updateMany({
      where: { jobKey: key },
      data: { status: JobStatus.SUCCEEDED, finishedAt: new Date(), lastError: note ?? null },
    });
  }

  async failed(key: string, error: string, final: boolean) {
    await this.prisma.jobRecord.updateMany({
      where: { jobKey: key },
      data: { status: final ? JobStatus.DEAD : JobStatus.FAILED, lastError: error.slice(0, 1000), finishedAt: final ? new Date() : null },
    });
  }
}
