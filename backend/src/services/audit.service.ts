import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService, Tx } from '../database/prisma.service';

export interface AuditEntry {
  actorId?: string | null;
  actorRole?: Role | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Records an audit entry. Pass `tx` to make it atomic with the audited change. */
  async record(entry: AuditEntry, tx?: Tx) {
    const db = tx ?? this.prisma;
    try {
      await db.auditLog.create({ data: { ...entry, userAgent: entry.userAgent?.slice(0, 300) } });
    } catch (err) {
      if (tx) throw err;
      this.logger.error({ err, action: entry.action }, 'Failed to write audit log');
    }
  }
}
