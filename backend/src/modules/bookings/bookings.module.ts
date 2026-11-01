import { Module } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { AvailabilityModule } from '../availability/availability.module';
import { EarningsModule } from '../earnings/earnings.module';

@Module({ imports: [AvailabilityModule, EarningsModule],controllers: [BookingsController], providers: [BookingsService], exports: [BookingsService] })
export class BookingsModule {}
