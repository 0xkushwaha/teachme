import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { CurrentUser, Roles } from '../../common/decorators';
import type { AuthUser } from '../../common/auth-user';
import { PaginationQuery } from '../../common/dto/pagination.dto';
import { AppError } from '../../common/errors';
import { SettingsService } from '../../services/settings.service';
import { AuditService } from '../../services/audit.service';
import { settingDescriptions, SettingKey, settingSchemas } from '../../services/settings.definitions';
import { AnalyticsService } from '../analytics/analytics.service';
import { BookingsService } from '../bookings/bookings.service';
import { PaymentsService } from '../payments/payments.service';
import { SubjectsService } from '../subjects/subjects.service';
import { UpsertCategoryDto, UpsertSubjectDto } from '../subjects/dto/subjects.dto';
import { UpdateTicketDto } from '../support/dto/support.dto';
import { AdminService } from './admin.service';
import {
  AdminBookingsQuery,
  AdminCancelDto,
  AdminJobsQuery,
  AdminPaymentsQuery,
  AdminTeachersQuery,
  AdminUsersQuery,
  AuditQuery,
  ResolveDiscrepancyDto,
  TeacherApprovalDto,
  TicketsQuery,
  UpdateTemplateDto,
  UpdateUserRoleDto,
  UpdateUserStatusDto,
} from './dto/admin.dto';

class RefundsQuery extends PaginationQuery {
  @IsOptional() @IsIn(['PENDING', 'SUBMITTED', 'PROCESSED', 'FAILED']) status?: string;
}
class WebhooksQuery extends PaginationQuery {
  @IsOptional() @IsIn(['true', 'false']) failed?: string;
}

/** Every route here is ADMIN-only, enforced server-side by the global AuthGuard. */
@ApiTags('admin')
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly analytics: AnalyticsService,
    private readonly bookings: BookingsService,
    private readonly payments: PaymentsService,
    private readonly subjects: SubjectsService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  @Get('overview')
  overview(@Query('days') days?: string) {
    const d = Math.min(365, Math.max(1, Number(days) || 30));
    return this.analytics.overview(d);
  }

  // users
  @Get('users') users(@Query() q: AdminUsersQuery) { return this.admin.users(q); }
  @Patch('users/:id/status')
  userStatus(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserStatusDto) {
    return this.admin.setUserStatus(a, id, dto.status, dto.reason);
  }
  @Patch('users/:id/role')
  userRole(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserRoleDto) {
    return this.admin.setUserRole(a, id, dto.role);
  }

  // teachers
  @Get('teachers') teachers(@Query() q: AdminTeachersQuery) { return this.admin.teachers(q); }
  @Post('teachers/:id/approval')
  @HttpCode(200)
  approval(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TeacherApprovalDto) {
    return this.admin.setTeacherApproval(a, id, dto.status, dto.note);
  }

  // subjects & categories
  @Get('subjects') subjectsList() { return this.subjects.listAll(); }
  @Post('subjects')
  async createSubject(@CurrentUser() a: AuthUser, @Body() dto: UpsertSubjectDto) {
    const s = await this.subjects.create(dto);
    await this.audit.record({ actorId: a.id, actorRole: 'ADMIN', action: 'admin.subject_created', entityType: 'Subject', entityId: s.id });
    return s;
  }
  @Patch('subjects/:id')
  async updateSubject(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpsertSubjectDto) {
    const s = await this.subjects.update(id, dto);
    await this.audit.record({ actorId: a.id, actorRole: 'ADMIN', action: 'admin.subject_updated', entityType: 'Subject', entityId: id });
    return s;
  }
  @Get('categories') categories() { return this.subjects.categories(); }
  @Post('categories')
  async createCategory(@CurrentUser() a: AuthUser, @Body() dto: UpsertCategoryDto) {
    const c = await this.subjects.createCategory(dto);
    await this.audit.record({ actorId: a.id, actorRole: 'ADMIN', action: 'admin.category_created', entityType: 'SubjectCategory', entityId: c.id });
    return c;
  }
  @Patch('categories/:id')
  async updateCategory(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpsertCategoryDto) {
    const c = await this.subjects.updateCategory(id, dto);
    await this.audit.record({ actorId: a.id, actorRole: 'ADMIN', action: 'admin.category_updated', entityType: 'SubjectCategory', entityId: id });
    return c;
  }

  // bookings
  @Get('bookings') bookingsList(@Query() q: AdminBookingsQuery) { return this.admin.bookings(q); }
  @Get('bookings/:id') booking(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.bookings.view(a, id); }
  @Post('bookings/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminCancelDto) {
    return this.bookings.cancel(a, id, dto.reason, dto.refundPercent);
  }

  // payments & refunds
  @Get('payments') paymentsList(@Query() q: AdminPaymentsQuery) { return this.admin.payments(q); }
  @Post('payments/:id/reconcile')
  @HttpCode(200)
  async reconcile(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const r = await this.payments.reconcileOne(id);
    await this.audit.record({ actorId: a.id, actorRole: 'ADMIN', action: 'admin.payment_reconciled', entityType: 'Payment', entityId: id, metadata: { outcome: r.outcome } });
    return r;
  }
  @Post('payments/:id/resolve')
  @HttpCode(200)
  resolve(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveDiscrepancyDto) {
    return this.admin.resolveDiscrepancy(a, id, dto.note);
  }
  @Get('refunds') refunds(@Query() q: RefundsQuery) { return this.admin.refunds(q, q.status); }
  @Post('refunds/:id/retry')
  @HttpCode(202)
  retryRefund(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.admin.retryRefund(a, id); }

  // integrations & jobs
  @Get('integrations/health') health() { return this.admin.integrationHealth(); }
  @Get('jobs') jobs(@Query() q: AdminJobsQuery) { return this.admin.jobsList(q); }
  @Post('jobs/:id/retry')
  @HttpCode(202)
  retryJob(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.admin.retryJob(a, id); }
  @Get('webhooks') webhooks(@Query() q: WebhooksQuery) { return this.admin.webhooks(q, q.failed === 'true'); }

  // notification templates
  @Get('notification-templates') templates() { return this.admin.templates(); }
  @Put('notification-templates/:key')
  updateTemplate(@CurrentUser() a: AuthUser, @Param('key') key: string, @Body() dto: UpdateTemplateDto) { return this.admin.updateTemplate(a, key, dto); }
  @Delete('notification-templates/:key')
  @HttpCode(204)
  resetTemplate(@CurrentUser() a: AuthUser, @Param('key') key: string) { return this.admin.resetTemplate(a, key); }
  @Get('notification-templates/:key/preview') preview(@Param('key') key: string) { return this.admin.previewTemplate(key); }

  // audit
  @Get('audit-logs') auditLogs(@Query() q: AuditQuery) { return this.admin.auditLogs(q); }

  // settings & feature flags
  @Get('settings')
  async allSettings() {
    const values = await this.settings.all();
    return Object.keys(settingSchemas).map((key) => ({ key, description: settingDescriptions[key as SettingKey], value: values[key] }));
  }
  @Put('settings/:key')
  async setSetting(@CurrentUser() a: AuthUser, @Param('key') key: string, @Body() body: { value: unknown }) {
    if (!(key in settingSchemas)) throw AppError.notFound('Setting');
    const before = await this.settings.get(key as SettingKey);
    const value = await this.settings.set(key as SettingKey, body?.value, a.id);
    await this.audit.record({ actorId: a.id, actorRole: 'ADMIN', action: 'admin.setting_changed', entityType: 'PlatformSetting', entityId: key, metadata: { before, after: value } as never });
    return { key, value };
  }

  // support
  @Get('support-tickets') tickets(@Query() q: TicketsQuery) { return this.admin.tickets(q); }
  @Patch('support-tickets/:id')
  ticket(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTicketDto) { return this.admin.updateTicket(a, id, dto.status, dto.adminNote); }
}
