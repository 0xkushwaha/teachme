import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class UpsertSubjectDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @IsOptional()
  @Matches(/^[a-z0-9-]{2,60}$/)
  slug?: string;

  @IsString()
  @MaxLength(600)
  description: string;

  @IsUUID()
  categoryId: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpsertCategoryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;

  @IsOptional()
  @Matches(/^[a-z0-9-]{2,60}$/)
  slug?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
