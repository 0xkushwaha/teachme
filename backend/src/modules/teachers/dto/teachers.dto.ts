import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PaginationQuery } from '../../../common/dto/pagination.dto';

export class SearchTeachersQuery extends PaginationQuery {
  @IsOptional()
  @Matches(/^[a-z0-9-]{1,60}$/)
  subject?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  language?: string;

  /** ISO weekday 1-7 the teacher has working hours on. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(7)
  availableOn?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60)
  minExperience?: number;

  @IsOptional()
  @IsIn(['recommended', 'price_asc', 'price_desc', 'experience', 'newest'])
  sort: 'recommended' | 'price_asc' | 'price_desc' | 'experience' | 'newest' = 'recommended';
}

export class QualificationDto {
  @IsString()
  @MaxLength(120)
  title: string;

  @IsString()
  @MaxLength(120)
  institution: string;

  @IsOptional()
  @IsInt()
  @Min(1950)
  @Max(2100)
  year?: number;
}

export class UpdateTeacherProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(140)
  headline?: string;

  @IsOptional()
  @IsString()
  @MinLength(50)
  @MaxLength(4000)
  bio?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => QualificationDto)
  qualifications?: QualificationDto[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  yearsExperience?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  @Transform(({ value }) => (Array.isArray(value) ? value.map((v) => String(v).trim()).filter(Boolean) : value))
  languages?: string[];

  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  avatarUrl?: string;
}

export class TeacherSubjectDto {
  @IsUUID()
  subjectId: string;

  @IsInt()
  @Min(1)
  hourlyRateMinor: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  levels?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ReplaceTeacherSubjectsDto {
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => TeacherSubjectDto)
  subjects: TeacherSubjectDto[];
}
