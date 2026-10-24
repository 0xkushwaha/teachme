import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQuery } from '../../../common/dto/pagination.dto';

export class CreateBookingDto {
  @IsUUID()
  teacherId: string;

  @IsUUID()
  subjectId: string;

  /** Slot start as an ISO-8601 instant (UTC recommended). */
  @IsDateString()
  startAt: string;

  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(240)
  durationMinutes: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class CancelBookingDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class RescheduleBookingDto {
  @IsDateString()
  startAt: string;
}

export class ListBookingsQuery extends PaginationQuery {
  @IsOptional()
  @IsIn(['upcoming', 'past', 'cancelled', 'pending', 'all'])
  scope: 'upcoming' | 'past' | 'cancelled' | 'pending' | 'all' = 'upcoming';
}

export class CalendarRangeQuery {
  @IsDateString()
  from: string;

  @IsDateString()
  to: string;
}
