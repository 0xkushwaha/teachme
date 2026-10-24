import { Global, Module } from '@nestjs/common';
import { PAYMENT_GATEWAY } from './razorpay/payment-gateway';
import { RazorpayGateway } from './razorpay/razorpay.gateway';
import { CALENDAR_GATEWAY } from './google/calendar-gateway';
import { GoogleCalendarGateway } from './google/google-calendar.gateway';
import { EMAIL_PROVIDER } from './email/email-provider';
import { SmtpEmailProvider } from './email/smtp-email.provider';

@Global()
@Module({
  providers: [
    { provide: PAYMENT_GATEWAY, useClass: RazorpayGateway },
    { provide: CALENDAR_GATEWAY, useClass: GoogleCalendarGateway },
    { provide: EMAIL_PROVIDER, useClass: SmtpEmailProvider },
  ],
  exports: [PAYMENT_GATEWAY, CALENDAR_GATEWAY, EMAIL_PROVIDER],
})
export class IntegrationsModule {}
