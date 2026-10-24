import { Module } from '@nestjs/common';
import { MeetingsController } from './meetings.controller';
import { BookingsModule } from '../bookings/bookings.module';
import { CalendarModule } from '../calendar/calendar.module';

@Module({ imports: [BookingsModule, CalendarModule], controllers: [MeetingsController] })
export class MeetingsModule {}
