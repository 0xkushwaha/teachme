import { Inject, Injectable } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { AppConfig } from '../../config/app-config';
import { PrismaService } from '../../database/prisma.service';
import { EMAIL_PROVIDER, EmailDeliveryError, EmailProvider } from '../../integrations/email/email-provider';
import { render } from './template-renderer';
import { TEMPLATE_BY_KEY, wrapEmailLayout } from './templates/defaults';

/**
 * Delivers one EMAIL notification. Idempotent: a notification already SENT is never re-sent.
 * Status moves to SENT only after the provider returns a message id.
 */
@Injectable()
export class EmailSenderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    @Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider,
  ) {}

  async send(notificationId: string, attempt: number, finalAttempt: boolean) {
    const n = await this.prisma.notification.findUnique({ where: { id: notificationId }, include: { user: { select: { email: true, status: true } } } });
    if (!n || n.channel !== 'EMAIL') return 'missing';
    if (n.status === 'SENT' || n.status === 'SKIPPED') return 'already-done';
    if (n.user.status === 'DELETED') {
      await this.prisma.notification.update({ where: { id: n.id }, data: { status: 'SKIPPED', lastError: 'User deleted' } });
      return 'skipped';
    }

    const rendered = await this.renderEmail(n.type, ((n.data as { context?: Record<string, unknown> })?.context ?? {}) as Record<string, unknown>);
    try {
      const { messageId } = await this.provider.send({
        to: n.user.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        idempotencyKey: n.id,
      });
      await this.prisma.notification.update({
        where: { id: n.id },
        data: { status: 'SENT', providerMessageId: messageId, sentAt: new Date(), attempts: attempt, lastError: null },
      });
      return 'sent';
    } catch (err) {
      const e = err as EmailDeliveryError;
      const permanent = e instanceof EmailDeliveryError && e.permanent;
      await this.prisma.notification.update({
        where: { id: n.id },
        data: { attempts: attempt, lastError: String(e.message).slice(0, 500), status: permanent || finalAttempt ? 'FAILED' : 'PENDING' },
      });
      if (permanent) throw new UnrecoverableError(e.message);
      throw err;
    }
  }

  async renderEmail(templateKey: string, context: Record<string, unknown>) {
    const stored = await this.prisma.notificationTemplate.findUnique({ where: { key: templateKey } });
    const def = TEMPLATE_BY_KEY.get(templateKey);
    const subject = stored?.subject ?? def?.subject ?? templateKey;
    const html = stored?.htmlBody ?? def?.html ?? '';
    const text = stored?.textBody ?? def?.text ?? '';
    const renderedSubject = render(subject, context, false).replace(/[\r\n]+/g, ' ');
    return {
      subject: renderedSubject,
      html: wrapEmailLayout(render(html, context, true), {
        appUrl: this.config.env.APP_URL,
        supportEmail: this.config.env.SUPPORT_EMAIL,
        preheader: renderedSubject,
        prefsUrl: typeof context.prefsUrl === 'string' ? context.prefsUrl : undefined,
      }),
      text: render(text, context, false),
    };
  }
}
