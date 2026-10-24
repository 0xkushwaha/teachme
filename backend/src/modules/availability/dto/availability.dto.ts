import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class WeeklyWindowDto {
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek: number;

  @IsInt()
  @Min(0)
  @Max(1439)
  startMinute: number;

  @IsInt()
  @Min(1)
  @Max(1440)
  endMinute: number;
}

export class ReplaceWeeklyDto {
  @IsArray()
  @ArrayMaxSize(70)
  @ValidateNested({ each: true })
  @Type(() => WeeklyWindowDto)
  windows: WeeklyWindowDto[];
}

export class CreateExceptionDto {
  @IsIn(['UNAVAILABLE', 'AVAILABLE'])
  type: 'UNAVAILABLE' | 'AVAILABLE';

  @IsDateString()
  startAt: string;

  @IsDateString()
  endAt: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class TeachingSettingsDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsInt({ each: true })
  sessionDurations?: number[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  bufferMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10080)
  minNoticeMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  maxAdvanceDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}

export class SlotsQuery {
  @IsDateString()
  from: string;

  @IsDateString()
  to: string;

  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(240)
  durationMinutes: number;
}
