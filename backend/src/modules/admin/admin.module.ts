import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AnalyticsModule } from '../analytics/analytics.module';
import { BookingsModule } from '../bookings/bookings.module';
import { PaymentsModule } from '../payments/payments.module';
import { SubjectsModule } from '../subjects/subjects.module';

@Module({ imports: [AnalyticsModule, BookingsModule, PaymentsModule, SubjectsModule], controllers: [AdminController], providers: [AdminService] })
export class AdminModule {}
