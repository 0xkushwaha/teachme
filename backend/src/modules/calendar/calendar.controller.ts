import { Controller, Delete, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUser, Public, Roles } from '../../common/decorators';
import type { AuthUser } from '../../common/auth-user';
import { AppConfig } from '../../config/app-config';
import { CalendarConnectionService } from './calendar-connection.service';

const STATE_COOKIE = 'tm_oauth_state';

@ApiTags('integrations')
@Controller('integrations/google')
export class CalendarController {
  constructor(
    private readonly connections: CalendarConnectionService,
    private readonly config: AppConfig,
  ) {}

  @Roles('TEACHER')
  @Get('status')
  status(@CurrentUser() user: AuthUser) {
    return this.connections.status(user.id);
  }

  /** Returns the Google consent URL; the browser navigates there. */
  @Roles('TEACHER')
  @HttpCode(200)
  @Post('connect')
  async connect(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    const { url, state } = await this.connections.start(user.id, user.email);
    res.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      secure: this.config.env.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/api/v1/integrations/google',
      maxAge: 600_000,
    });
    return { url };
  }

  /** OAuth redirect target (registered in Google Cloud Console). */
  @Public()
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const target = new URL('/teacher/integrations', this.config.env.APP_URL);
    res.clearCookie(STATE_COOKIE, { path: '/api/v1/integrations/google' });
    try {
      await this.connections.complete({ code, state, error, cookieState: req.cookies?.[STATE_COOKIE] });
      target.searchParams.set('google', 'connected');
    } catch (err) {
      target.searchParams.set('google', 'error');
      target.searchParams.set('reason', (err as Error).message.slice(0, 120));
    }
    res.redirect(302, target.toString());
  }

  @Roles('TEACHER')
  @HttpCode(204)
  @Delete('connection')
  async disconnect(@CurrentUser() user: AuthUser) {
    await this.connections.disconnect(user.id);
  }
}
