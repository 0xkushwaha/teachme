import { DynamicModule, MiddlewareConsumer, Module, NestModule, Provider } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from './config/config.module';
import { loggerModule } from './config/logger';
import { loadEnv } from './config/env.schema';
import { DatabaseModule } from './database/database.module';
import { CoreModule } from './services/core.module';
import { RedisService } from './services/redis.service';
import { RedisThrottlerStorage } from './services/redis-throttler.storage';
import { JobsModule } from './jobs/jobs.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { AuthGuard } from './common/guards/auth.guard';
import { CsrfGuard } from './common/guards/csrf.guard';
import { AppThrottlerGuard } from './common/guards/throttler.guard';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { RequestContextMiddleware } from './middleware/request-context.middleware';
import { HealthController } from './routes/health.controller';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { StudentsModule } from './modules/students/students.module';
import { TeachersModule } from './modules/teachers/teachers.module';
import { SubjectsModule } from './modules/subjects/subjects.module';
import { AvailabilityModule } from './modules/availability/availability.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { MeetingsModule } from './modules/meetings/meetings.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AdminModule } from './modules/admin/admin.module';
import { SupportModule } from './modules/support/support.module';
import { OutboxDispatcher } from './jobs/outbox.dispatcher';
import { QueueWorkersService } from './jobs/processors/queue-workers.service';

/** Modules shared by the HTTP API and the worker process. */
export const SHARED_IMPORTS = [
  ConfigModule,
  DatabaseModule,
  CoreModule,
  JobsModule,
  IntegrationsModule,
  AuthModule,
  NotificationsModule,
  AvailabilityModule,
  BookingsModule,
  PaymentsModule,
  CalendarModule,
];

export const WORKER_PROVIDERS: Provider[] = [OutboxDispatcher, QueueWorkersService];

@Module({})
export class AppModule implements NestModule {
  static register(opts: { workers?: boolean; extraImports?: DynamicModule[] } = {}): DynamicModule {
    const env = loadEnv();
    return {
      module: AppModule,
      imports: [
        loggerModule(),
        ...SHARED_IMPORTS,
        ThrottlerModule.forRootAsync({
          inject: [RedisService],
          useFactory: (redis: RedisService) => ({
            throttlers: [{ name: 'default', ttl: 60_000, limit: env.THROTTLE_GLOBAL_LIMIT }],
            storage: new RedisThrottlerStorage(redis),
          }),
        }),
        UsersModule,
        StudentsModule,
        TeachersModule,
        SubjectsModule,
        MeetingsModule,
        AdminModule,
        SupportModule,
        ...(opts.extraImports ?? []),
      ],
      controllers: [HealthController],
      providers: [
        // Guard order matters: authenticate → CSRF (needs auth mode) → rate limit (keys by user).
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: CsrfGuard },
        { provide: APP_GUARD, useClass: AppThrottlerGuard },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        ...(opts.workers ? WORKER_PROVIDERS : []),
      ],
    };
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
