import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators';
import type { AuthUser } from '../../common/auth-user';
import { paginate } from '../../common/dto/pagination.dto';
import { NotificationsService } from './notifications.service';
import { ListNotificationsQuery, UpdatePreferencesDto } from './dto/notifications.dto';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() q: ListNotificationsQuery) {
    const [rows, total] = await this.notifications.list(user.id, { unreadOnly: q.unread === 'true', skip: q.skip, take: q.pageSize });
    return paginate(rows, total, q);
  }

  @Get('unread-count')
  async unread(@CurrentUser() user: AuthUser) {
    return { count: await this.notifications.unreadCount(user.id) };
  }

  @HttpCode(204)
  @Post(':id/read')
  async read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.notifications.markRead(user.id, id);
  }

  @HttpCode(204)
  @Post('read-all')
  async readAll(@CurrentUser() user: AuthUser) {
    await this.notifications.markAllRead(user.id);
  }

  @Get('preferences')
  async prefs(@CurrentUser() user: AuthUser) {
    return { preferences: await this.notifications.getPreferences(user.id) };
  }

  @Put('preferences')
  async setPrefs(@CurrentUser() user: AuthUser, @Body() dto: UpdatePreferencesDto) {
    return { preferences: await this.notifications.setPreferences(user.id, dto.preferences) };
  }
}
