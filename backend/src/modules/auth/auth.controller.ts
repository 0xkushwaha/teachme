import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AppConfig } from '../../config/app-config';
import { CurrentUser, Public, SkipCsrf } from '../../common/decorators';
import type { AuthUser } from '../../common/auth-user';
import type { AuthedRequest } from '../../common/guards/auth.guard';
import { PrismaService } from '../../database/prisma.service';
import { AppError } from '../../common/errors';
import { AuthService, ClientInfo } from './auth.service';
import { ChangePasswordDto, EmailDto, LoginDto, RegisterDto, ResetPasswordDto, TokenDto } from './dto/auth.dto';
import { clearAuthCookies, CSRF_COOKIE, ensureCsrfCookie, REFRESH_COOKIE, setAuthCookies } from './cookies';
import { toSelfUser } from '../users/user.mapper';

const STRICT = { default: { limit: 10, ttl: 60_000 } };

export function clientInfo(req: Request): ClientInfo {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  /** Issues the CSRF cookie for anonymous visitors (call before login/register). */
  @Public()
  @Get('csrf')
  csrf(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return { csrfToken: ensureCsrfCookie(res, this.config, req.cookies?.[CSRF_COOKIE]) };
  }

  @Public()
  @Throttle(STRICT)
  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.register(dto, clientInfo(req));
    const issued = await this.auth.login(dto.email, dto.password, clientInfo(req));
    setAuthCookies(res, this.config, issued.accessToken, issued.refreshToken);
    return { user: await this.self(issued.user.id) };
  }

  @Public()
  @Throttle(STRICT)
  @HttpCode(200)
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const issued = await this.auth.login(dto.email, dto.password, clientInfo(req));
    setAuthCookies(res, this.config, issued.accessToken, issued.refreshToken);
    return { user: await this.self(issued.user.id) };
  }

  /** Programmatic clients (mobile apps, load tests) receive tokens in the body instead of cookies. */
  @Public()
  @SkipCsrf() // cookie-less: tokens are returned in the body and sent back as Bearer headers
  @Throttle(STRICT)
  @HttpCode(200)
  @Post('token')
  async token(@Body() dto: LoginDto, @Req() req: Request) {
    const issued = await this.auth.login(dto.email, dto.password, clientInfo(req));
    return { accessToken: issued.accessToken, refreshToken: issued.refreshToken, expiresIn: this.config.env.ACCESS_TOKEN_TTL_SECONDS };
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE] ?? (req.body as { refreshToken?: string })?.refreshToken;
    if (!token) {
      clearAuthCookies(res, this.config);
      throw AppError.unauthenticated('No session');
    }
    try {
      const issued = await this.auth.refresh(token, clientInfo(req));
      setAuthCookies(res, this.config, issued.accessToken, issued.refreshToken);
      return { user: await this.self(issued.user.id) };
    } catch (err) {
      clearAuthCookies(res, this.config);
      throw err;
    }
  }

  @Public()
  @HttpCode(204)
  @Post('logout')
  async logout(@Req() req: AuthedRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE], req.sessionId);
    clearAuthCookies(res, this.config);
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    return { user: await this.self(user.id) };
  }

  @Public()
  @Throttle(STRICT)
  @HttpCode(200)
  @Post('verify-email')
  async verifyEmail(@Body() dto: TokenDto) {
    await this.auth.verifyEmail(dto.token);
    return { verified: true };
  }

  @Throttle({ default: { limit: 3, ttl: 300_000 } })
  @HttpCode(202)
  @Post('resend-verification')
  async resend(@CurrentUser() user: AuthUser) {
    await this.auth.resendVerification(user.id);
    return { queued: true };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  @HttpCode(202)
  @Post('forgot-password')
  async forgot(@Body() dto: EmailDto, @Req() req: Request) {
    await this.auth.forgotPassword(dto.email, clientInfo(req));
    return { message: 'If an account exists for that email, a reset link has been sent.' };
  }

  @Public()
  @Throttle(STRICT)
  @HttpCode(200)
  @Post('reset-password')
  async reset(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    await this.auth.resetPassword(dto.token, dto.password, clientInfo(req));
    return { reset: true };
  }

  @Throttle(STRICT)
  @HttpCode(200)
  @Post('change-password')
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto, @Req() req: Request) {
    await this.auth.changePassword(user.id, dto.currentPassword, dto.newPassword, clientInfo(req));
    return { changed: true };
  }

  private async self(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { teacherProfile: { select: { id: true, slug: true, approvalStatus: true } } },
    });
    return toSelfUser(user);
  }
}
