import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationContextService } from './notification-context.service';
import { EmailSenderService } from './email-sender.service';
import { ReminderSchedulerService } from './reminder-scheduler.service';
import { ReminderService } from './reminder.service';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationContextService, EmailSenderService, ReminderSchedulerService, ReminderService],
  exports: [NotificationsService, NotificationContextService, EmailSenderService, ReminderSchedulerService, ReminderService],
})
export class NotificationsModule {}
