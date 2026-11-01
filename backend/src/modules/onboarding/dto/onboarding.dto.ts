import { Transform } from 'class-transformer';
import { Equals, IsBoolean, IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PaginationQuery } from '../../../common/dto/pagination.dto';
import { PASSWORD_MESSAGE, PASSWORD_RULE, TokenDto } from '../../auth/dto/auth.dto';

const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateInvitationDto {
  @Transform(lower)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class InvitationsQuery extends PaginationQuery {
  @IsOptional() @IsIn(['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED']) status?: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

export class InspectInvitationDto extends TokenDto {}

export class AcceptInvitationDto extends TokenDto {
  @IsString()
  @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE })
  password: string;

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  fullName: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsBoolean()
  @Equals(true, { message: 'You must accept the Terms of Service and Privacy Policy' })
  acceptTerms: boolean;
}

export const DOCUMENT_TYPES = ['DEGREE', 'CERTIFICATE', 'ID_PROOF', 'EXPERIENCE', 'OTHER'] as const;

/** Multipart text fields that accompany a document upload. */
export class UploadDocumentDto {
  @IsIn(DOCUMENT_TYPES)
  type: (typeof DOCUMENT_TYPES)[number];

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  title: string;
}

export class ReviewDocumentDto {
  @IsIn(['VERIFIED', 'REJECTED'])
  status: 'VERIFIED' | 'REJECTED';

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;
}
