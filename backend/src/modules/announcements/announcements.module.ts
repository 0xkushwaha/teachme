import { Body, Controller, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AnnouncementAudience, Prisma } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsDateString, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser, Roles } from '../../common/decorators';
import type { AuthUser } from '../../common/auth-user';
import { paginate, PaginationQuery } from '../../common/dto/pagination.dto';
import { AppError, ErrorCode } from '../../common/errors';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../../services/audit.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class AnnouncementDto {
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(120) title: string;
  @Transform(trim) @IsString() @MinLength(3) @MaxLength(2000) body: string;
  @IsIn(['ALL', 'STUDENT', 'TEACHER']) audience: AnnouncementAudience;
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() endsAt?: string | null;
}

class AnnouncementsQuery extends PaginationQuery {
  @IsOptional() @IsIn(['active', 'archived', 'all']) view?: 'active' | 'archived' | 'all';
}

@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Announcements currently visible to a role. Bodies are plain text; the UI never renders HTML. */
  active(role: AuthUser['role']) {
    const now = new Date();
    const audiences: AnnouncementAudience[] = role === 'ADMIN' ? ['ALL', 'STUDENT', 'TEACHER'] : ['ALL', role as AnnouncementAudience];
    return this.prisma.announcement.findMany({
      where: { archivedAt: null, audience: { in: audiences }, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      orderBy: { startsAt: 'desc' },
      take: 5,
      select: { id: true, title: true, body: true, audience: true, startsAt: true, endsAt: true },
    });
  }

  async list(q: AnnouncementsQuery) {
    const where: Prisma.AnnouncementWhereInput = q.view === 'archived' ? { archivedAt: { not: null } } : q.view === 'all' ? {} : { archivedAt: null };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.announcement.findMany({ where, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.pageSize }),
      this.prisma.announcement.count({ where }),
    ]);
    return paginate(rows, total, q);
  }

  private window(dto: AnnouncementDto) {
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : new Date();
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    if (endsAt && endsAt <= startsAt) throw AppError.badRequest(ErrorCode.VALIDATION_FAILED, 'End time must be after the start time');
    return { startsAt, endsAt };
  }

  async create(admin: AuthUser, dto: AnnouncementDto) {
    const a = await this.prisma.announcement.create({ data: { title: dto.title, body: dto.body, audience: dto.audience, ...this.window(dto), createdById: admin.id } });
    await this.audit.record({ actorId: admin.id, actorRole: 'ADMIN', action: 'admin.announcement_created', entityType: 'Announcement', entityId: a.id, metadata: { audience: a.audience } });
    return a;
  }

  async update(admin: AuthUser, id: string, dto: AnnouncementDto) {
    const a = await this.prisma.announcement.update({ where: { id }, data: { title: dto.title, body: dto.body, audience: dto.audience, ...this.window(dto) } }).catch(() => {
      throw AppError.notFound('Announcement');
    });
    await this.audit.record({ actorId: admin.id, actorRole: 'ADMIN', action: 'admin.announcement_updated', entityType: 'Announcement', entityId: id });
    return a;
  }

  async archive(admin: AuthUser, id: string) {
    const res = await this.prisma.announcement.updateMany({ where: { id, archivedAt: null }, data: { archivedAt: new Date() } });
    if (res.count !== 1) throw AppError.notFound('Announcement');
    await this.audit.record({ actorId: admin.id, actorRole: 'ADMIN', action: 'admin.announcement_archived', entityType: 'Announcement', entityId: id });
    return { archived: true };
  }
}

@ApiTags('announcements')
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get()
  active(@CurrentUser() user: AuthUser) {
    return this.announcements.active(user.role);
  }
}

@ApiTags('admin')
@Roles('ADMIN')
@Controller('admin/announcements')
export class AdminAnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get() list(@Query() q: AnnouncementsQuery) { return this.announcements.list(q); }
  @Post() create(@CurrentUser() a: AuthUser, @Body() dto: AnnouncementDto) { return this.announcements.create(a, dto); }
  @Patch(':id') update(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AnnouncementDto) { return this.announcements.update(a, id, dto); }
  @HttpCode(200)
  @Post(':id/archive') archive(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.announcements.archive(a, id); }
}

@Module({ controllers: [AnnouncementsController, AdminAnnouncementsController], providers: [AnnouncementsService] })
export class AnnouncementsModule {}
