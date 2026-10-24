import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, ValidateNested } from 'class-validator';
import { NotificationCategory, NotificationChannel } from '@prisma/client';
import { PaginationQuery } from '../../../common/dto/pagination.dto';

export class ListNotificationsQuery extends PaginationQuery {
  @IsOptional()
  @IsIn(['true', 'false'])
  unread?: 'true' | 'false';
}

export class PreferenceItem {
  @IsIn(['EMAIL', 'IN_APP'])
  channel: NotificationChannel;

  @IsIn(['BOOKING', 'REMINDER', 'PAYMENT', 'MARKETING'])
  category: NotificationCategory;

  @IsBoolean()
  enabled: boolean;
}

export class UpdatePreferencesDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PreferenceItem)
  preferences: PreferenceItem[];
}
