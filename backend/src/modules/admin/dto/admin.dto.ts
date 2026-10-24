import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PaginationQuery } from '../../../common/dto/pagination.dto';

export class AdminUsersQuery extends PaginationQuery {
  @IsOptional() @IsIn(['STUDENT', 'TEACHER', 'ADMIN']) role?: 'STUDENT' | 'TEACHER' | 'ADMIN';
  @IsOptional() @IsIn(['ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'DELETED']) status?: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED' | 'DELETED';
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

export class AdminTeachersQuery extends PaginationQuery {
  @IsOptional() @IsIn(['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED']) approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

export class UpdateUserStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED', 'DEACTIVATED']) status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

export class UpdateUserRoleDto {
  @IsIn(['STUDENT', 'TEACHER', 'ADMIN']) role: 'STUDENT' | 'TEACHER' | 'ADMIN';
}

export class TeacherApprovalDto {
  @IsIn(['APPROVED', 'REJECTED', 'SUSPENDED', 'PENDING']) status: 'APPROVED' | 'REJECTED' | 'SUSPENDED' | 'PENDING';
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class AdminBookingsQuery extends PaginationQuery {
  @IsOptional() @IsIn(['PENDING_PAYMENT', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'PAYMENT_FAILED']) status?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsUUID() teacherId?: string;
  @IsOptional() @IsUUID() studentId?: string;
}

export class AdminCancelDto {
  @IsString() @MinLength(3) @MaxLength(500) reason: string;
  @Type(() => Number) @IsInt() @Min(0) @Max(100) refundPercent: number;
}

export class AdminPaymentsQuery extends PaginationQuery {
  @IsOptional() @IsIn(['CREATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED']) status?: string;
  @IsOptional() @IsIn(['true', 'false']) discrepancy?: 'true' | 'false';
}

export class ResolveDiscrepancyDto {
  @IsString() @MinLength(3) @MaxLength(500) note: string;
}

export class AdminJobsQuery extends PaginationQuery {
  @IsOptional() @IsIn(['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'DEAD']) status?: string;
  @IsOptional() @IsString() @MaxLength(60) queue?: string;
}

export class AuditQuery extends PaginationQuery {
  @IsOptional() @IsString() @MaxLength(80) action?: string;
  @IsOptional() @IsUUID() actorId?: string;
  @IsOptional() @IsString() @MaxLength(60) entityType?: string;
}

export class UpdateTemplateDto {
  @IsString() @MinLength(3) @MaxLength(200) subject: string;
  @IsString() @MinLength(10) @MaxLength(20000) htmlBody: string;
  @IsString() @MinLength(10) @MaxLength(10000) textBody: string;
}

export class TicketsQuery extends PaginationQuery {
  @IsOptional() @IsIn(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']) status?: string;
}
