import { Transform } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateTicketDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email: string;

  @IsIn(['BOOKING_ISSUE', 'PAYMENT', 'TECHNICAL', 'ACCOUNT', 'TEACHER_APPLICATION', 'OTHER'])
  category: string;

  @IsString()
  @MinLength(4)
  @MaxLength(140)
  subject: string;

  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  message: string;

  @IsOptional()
  @IsUUID()
  bookingId?: string;
}

export class UpdateTicketDto {
  @IsIn(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'])
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  adminNote?: string;
}
