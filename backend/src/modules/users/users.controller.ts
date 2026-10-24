import { Body, Controller, Get, HttpCode, Patch, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators';
import type { AuthUser } from '../../common/auth-user';
import { AppConfig } from '../../config/app-config';
import { clearAuthCookies } from '../auth/cookies';
import { UsersService } from './users.service';
import { DeleteAccountDto, UpdateMeDto } from './dto/users.dto';

@ApiTags('users')
@Controller('users/me')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly config: AppConfig,
  ) {}

  @Patch()
  async update(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    return { user: await this.users.update(user.id, dto) };
  }

  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @Get('export')
  async export(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Content-Disposition', 'attachment; filename="teachme-data-export.json"');
    res.setHeader('Cache-Control', 'no-store');
    return this.users.export(user.id);
  }

  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @HttpCode(204)
  @Post('delete')
  async delete(@CurrentUser() user: AuthUser, @Body() dto: DeleteAccountDto, @Res({ passthrough: true }) res: Response) {
    await this.users.delete(user.id, dto.password);
    clearAuthCookies(res, this.config);
  }
}
