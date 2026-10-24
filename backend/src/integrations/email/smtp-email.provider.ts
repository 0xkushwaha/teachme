import { Injectable, OnModuleDestroy } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';
import { AppConfig } from '../../config/app-config';
import { EmailDeliveryError, EmailMessage, EmailProvider } from './email-provider';

/**
 * SMTP adapter (nodemailer). Works with any transactional provider exposing SMTP
 * (Amazon SES, Postmark, SendGrid, Resend, Mailgun) and with Mailpit locally.
 * "SENT" means the provider accepted the message (returned a message id) — not that it was delivered.
 */
@Injectable()
export class SmtpEmailProvider implements EmailProvider, OnModuleDestroy {
  readonly name = 'smtp';
  private transporter: Transporter | null = null;

  constructor(private readonly config: AppConfig) {
    if (config.emailConfigured) {
      this.transporter = nodemailer.createTransport({
        host: config.env.SMTP_HOST,
        port: config.env.SMTP_PORT,
        secure: config.env.SMTP_SECURE,
        auth: config.env.SMTP_USER ? { user: config.env.SMTP_USER, pass: config.env.SMTP_PASSWORD } : undefined,
        pool: true,
        maxConnections: 5,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      });
    }
  }

  get configured() {
    return this.transporter !== null;
  }

  async send(message: EmailMessage) {
    if (!this.transporter) throw new EmailDeliveryError('Email provider is not configured', true);
    try {
      const info = await this.transporter.sendMail({
        from: this.config.env.EMAIL_FROM,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: { 'X-Entity-Ref-ID': message.idempotencyKey },
      });
      if (!info.messageId) throw new EmailDeliveryError('Provider did not return a message id');
      if (info.rejected?.length) throw new EmailDeliveryError(`Recipient rejected: ${info.rejected.join(', ')}`, true);
      return { messageId: info.messageId };
    } catch (err) {
      if (err instanceof EmailDeliveryError) throw err;
      const e = err as { responseCode?: number; message?: string };
      // 5xx SMTP replies are permanent failures (bad address etc.), others are transient.
      throw new EmailDeliveryError(e.message ?? 'SMTP send failed', Boolean(e.responseCode && e.responseCode >= 500));
    }
  }

  onModuleDestroy() {
    this.transporter?.close();
  }
}
