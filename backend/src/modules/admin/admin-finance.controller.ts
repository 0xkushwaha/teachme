import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, NotEquals } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../../common/decorators';
import type { AuthUser } from '../../common/auth-user';
import { PaginationQuery } from '../../common/dto/pagination.dto';
import { AppError, ErrorCode } from '../../common/errors';
import { AuditService } from '../../services/audit.service';
import { EarningsService } from '../earnings/earnings.service';

class RangeQuery {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

class PayoutsQuery extends PaginationQuery {
  @IsOptional() @IsIn(['REQUESTED', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED']) status?: 'REQUESTED' | 'APPROVED' | 'PAID' | 'REJECTED' | 'CANCELLED';
  @IsOptional() @IsUUID() teacherId?: string;
}

class PayoutNoteDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

class MarkPaidDto extends PayoutNoteDto {
  /** Bank transfer reference (UTR / transaction id) for reconciliation. */
  @IsString() @MinLength(4) @MaxLength(100) reference: string;
}

class RejectPayoutDto {
  @IsString() @MinLength(5) @MaxLength(500) reason: string;
}

class AdjustmentDto {
  @Type(() => Number) @IsInt() @NotEquals(0) @Min(-10_000_000) @Max(10_000_000) amountMinor: number;
  @IsString() @MinLength(5) @MaxLength(200) description: string;
}

const MAX_RANGE_DAYS = 400;

function range(q: RangeQuery) {
  const to = q.to ? new Date(q.to) : new Date();
  const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 86_400_000);
  if (from >= to) throw AppError.badRequest(ErrorCode.VALIDATION_FAILED, '`from` must be before `to`');
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) throw AppError.badRequest(ErrorCode.VALIDATION_FAILED, `Range can be at most ${MAX_RANGE_DAYS} days`);
  return { from, to };
}

/** Platform finance and the manual payout queue. ADMIN only; every write is audited. */
@ApiTags('admin')
@Roles('ADMIN')
@Controller('admin')
export class AdminFinanceController {
  constructor(
    private readonly earnings: EarningsService,
    private readonly audit: AuditService,
  ) {}

  @Get('finance/summary')
  summary(@Query() q: RangeQuery) {
    const { from, to } = range(q);
    return this.earnings.financeSummary(from, to);
  }

  @Get('finance/report.csv')
  async report(@CurrentUser() a: AuthUser, @Query() q: RangeQuery, @Res() res: Response) {
    const { from, to } = range(q);
    const csv = await this.earnings.financeCsv(from, to);
    await this.audit.record({ actorId: a.id, actorRole: 'ADMIN', action: 'admin.finance_report_exported', entityType: 'Report', metadata: { from: from.toISOString(), to: to.toISOString() } });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="teachme-finance-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.csv"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(csv);
  }

  @Get('payouts')
  payouts(@Query() q: PayoutsQuery) {
    return this.earnings.adminList(q);
  }

  @HttpCode(200)
  @Post('payouts/:id/approve')
  approve(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PayoutNoteDto) {
    return this.earnings.approve(a, id, dto.note);
  }

  @HttpCode(200)
  @Post('payouts/:id/paid')
  paid(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MarkPaidDto) {
    return this.earnings.markPaid(a, id, dto.reference.trim(), dto.note);
  }

  @HttpCode(200)
  @Post('payouts/:id/reject')
  reject(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectPayoutDto) {
    return this.earnings.reject(a, id, dto.reason.trim());
  }

  @Post('teachers/:id/earnings/adjustments')
  adjust(@CurrentUser() a: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdjustmentDto) {
    return this.earnings.addAdjustment(a, id, dto.amountMinor, dto.description.trim());
  }

  @Get('teachers/:id/earnings')
  teacherEarnings(@Param('id', ParseUUIDPipe) id: string, @Query() q: PaginationQuery) {
    return Promise.all([this.earnings.summary(id), this.earnings.ledger(id, q)]).then(([summary, ledger]) => ({ summary, ledger }));
  }
}
