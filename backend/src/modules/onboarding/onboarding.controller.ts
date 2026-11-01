import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AppConfig } from '../../config/app-config';
import { CurrentUser, Public, Roles } from '../../common/decorators';
import type { AuthUser } from '../../common/auth-user';
import { PrismaService } from '../../database/prisma.service';
import { AuthService } from '../auth/auth.service';
import { clientInfo } from '../auth/auth.controller';
import { setAuthCookies } from '../auth/cookies';
import { toSelfUser } from '../users/user.mapper';
import { teacherId } from '../availability/availability.controller';
import { FILE_RULES, UploadedBlob } from '../files/files.service';
import { OnboardingService } from './onboarding.service';
import { AcceptInvitationDto, CreateInvitationDto, InspectInvitationDto, InvitationsQuery, ReviewDocumentDto, UploadDocumentDto } from './dto/onboarding.dto';

/**
 * Multer parses into memory (Nest's default when no `dest` is set) with hard limits; content is
 * then validated by FilesService. Guards (auth, CSRF, rate limit) run before the body is read.
 */
const upload = (maxBytes: number) => FileInterceptor('file', { limits: { fileSize: maxBytes, files: 1, fields: 5, fieldSize: 1024, parts: 7 } });

@ApiTags('admin')
@Roles('ADMIN')
@Controller('admin/invitations')
export class AdminInvitationsController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  list(@Query() q: InvitationsQuery) {
    return this.onboarding.list(q);
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post()
  invite(@CurrentUser() admin: AuthUser, @Body() dto: CreateInvitationDto) {
    return this.onboarding.invite(admin, dto.email, dto.note);
  }

  @HttpCode(200)
  @Post(':id/resend')
  resend(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.onboarding.resend(admin, id);
  }

  @HttpCode(200)
  @Post(':id/revoke')
  revoke(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.onboarding.revoke(admin, id);
  }
}

/** Tokens travel in the request body (not the URL) so they don't land in access logs. */
@ApiTags('auth')
@Controller('auth/invitations')
export class InvitationAcceptanceController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly auth: AuthService,
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(200)
  @Post('inspect')
  inspect(@Body() dto: InspectInvitationDto) {
    return this.onboarding.inspect(dto.token);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('accept')
  async accept(@Body() dto: AcceptInvitationDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.onboarding.accept(dto, clientInfo(req));
    const issued = await this.auth.login(user.email, dto.password, clientInfo(req));
    setAuthCookies(res, this.config, issued.accessToken, issued.refreshToken);
    const self = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { teacherProfile: { select: { id: true, slug: true, approvalStatus: true } } } });
    return { user: toSelfUser(self) };
  }
}

@ApiTags('teachers')
@Roles('TEACHER')
@Controller('teachers/me')
export class TeacherOnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('application')
  application(@CurrentUser() user: AuthUser) {
    return this.onboarding.application(teacherId(user));
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('application/submit')
  submit(@CurrentUser() user: AuthUser) {
    return this.onboarding.submitApplication(user, teacherId(user));
  }

  @Get('documents')
  documents(@CurrentUser() user: AuthUser) {
    return this.onboarding.documents(teacherId(user));
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('documents')
  @UseInterceptors(upload(FILE_RULES.TEACHER_DOCUMENT.maxBytes))
  uploadDocument(@CurrentUser() user: AuthUser, @UploadedFile() file: UploadedBlob | undefined, @Body() dto: UploadDocumentDto) {
    return this.onboarding.uploadDocument(user, teacherId(user), file, dto);
  }

  @Get('documents/:id/file')
  file(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    return this.onboarding.sendDocument(user, teacherId(user), id, res);
  }

  @HttpCode(204)
  @Delete('documents/:id')
  deleteDocument(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.onboarding.deleteDocument(user, teacherId(user), id);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('avatar')
  @UseInterceptors(upload(FILE_RULES.AVATAR.maxBytes))
  avatar(@CurrentUser() user: AuthUser, @UploadedFile() file: UploadedBlob | undefined) {
    return this.onboarding.uploadAvatar(user, teacherId(user), file);
  }

  @HttpCode(200)
  @Delete('avatar')
  removeAvatar(@CurrentUser() user: AuthUser) {
    return this.onboarding.removeAvatar(user, teacherId(user));
  }
}

@ApiTags('admin')
@Roles('ADMIN')
@Controller('admin/teachers')
export class AdminTeacherReviewController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.onboarding.teacherDetail(id);
  }

  @Get(':id/documents/:docId/file')
  file(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('docId', ParseUUIDPipe) docId: string, @Res() res: Response) {
    return this.onboarding.sendDocument(admin, id, docId, res);
  }

  @HttpCode(200)
  @Post(':id/documents/:docId/review')
  review(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('docId', ParseUUIDPipe) docId: string, @Body() dto: ReviewDocumentDto) {
    return this.onboarding.reviewDocument(admin, id, docId, dto.status, dto.note);
  }
}
