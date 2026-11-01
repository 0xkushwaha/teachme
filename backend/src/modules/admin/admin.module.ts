import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AnalyticsModule } from '../analytics/analytics.module';
import { BookingsModule } from '../bookings/bookings.module';
import { PaymentsModule } from '../payments/payments.module';
import { SubjectsModule } from '../subjects/subjects.module';
import { UsersModule } from '../users/users.module';
import { EarningsModule } from '../earnings/earnings.module';
import { AdminFinanceController } from './admin-finance.controller';

@Module({ imports: [AnalyticsModule, BookingsModule, PaymentsModule, SubjectsModule, UsersModule, EarningsModule], controllers: [AdminController, AdminFinanceController], providers: [AdminService] })
export class AdminModule {}
