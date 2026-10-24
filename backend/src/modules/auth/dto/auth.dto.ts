import { Transform } from 'class-transformer';
import { Equals, IsBoolean, IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{10,128}$/;
export const PASSWORD_MESSAGE = 'Password must be 10-128 characters and include upper case, lower case and a number';

export class RegisterDto {
  @Transform(lower)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE })
  password: string;

  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  fullName: string;

  @IsIn(['STUDENT', 'TEACHER'])
  role: 'STUDENT' | 'TEACHER';

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  /** Explicit consent to the Terms and Privacy Policy is required. */
  @IsBoolean()
  @Equals(true, { message: 'You must accept the Terms of Service and Privacy Policy' })
  acceptTerms: boolean;
}

export class LoginDto {
  @Transform(lower)
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;
}

export class TokenDto {
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token: string;
}

export class EmailDto {
  @Transform(lower)
  @IsEmail()
  email: string;
}

export class ResetPasswordDto extends TokenDto {
  @IsString()
  @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE })
  password: string;
}

export class ChangePasswordDto {
  @IsString()
  currentPassword: string;

  @IsString()
  @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE })
  newPassword: string;
}
