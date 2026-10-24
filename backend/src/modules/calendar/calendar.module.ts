import { Module } from '@nestjs/common';
import { CalendarController } from './calendar.controller';
import { CalendarConnectionService } from './calendar-connection.service';
import { CalendarSyncService } from './calendar-sync.service';

@Module({
  controllers: [CalendarController],
  providers: [CalendarConnectionService, CalendarSyncService],
  exports: [CalendarConnectionService, CalendarSyncService],
})
export class CalendarModule {}
