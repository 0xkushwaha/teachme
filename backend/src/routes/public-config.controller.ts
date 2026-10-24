import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators';
import { SettingsService } from '../services/settings.service';
import { PrismaService } from '../database/prisma.service';

/** Non-sensitive platform configuration for public pages (fees, policies, banner). */
@ApiTags('platform')
@Controller('platform')
export class PublicConfigController {
  constructor(
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Get('config')
  @Header('Cache-Control', 'public, max-age=60')
  async config() {
    const [pricing, cancellation, reschedule, booking, flags, reminders, teachers, subjects] = await Promise.all([
      this.settings.get('pricing.rules'),
      this.settings.get('policy.cancellation'),
      this.settings.get('policy.reschedule'),
      this.settings.get('booking.rules'),
      this.settings.get('features.flags'),
      this.settings.get('notifications.reminders'),
      this.prisma.teacherProfile.count({ where: { approvalStatus: 'APPROVED', user: { status: 'ACTIVE' } } }),
      this.prisma.subject.count({ where: { isActive: true } }),
    ]);
    return {
      pricing: { currency: pricing.currency, platformFeeBps: pricing.platformFeeBps, taxBps: pricing.taxBps, taxBase: pricing.taxBase },
      policy: { cancellation, reschedule },
      booking: { holdMinutes: booking.holdMinutes, allowedDurations: booking.allowedDurations },
      reminders: { offsetsMinutes: reminders.offsetsMinutes },
      registration: { students: flags.studentRegistration, teachers: flags.teacherRegistration },
      maintenanceBanner: flags.maintenanceBanner,
      counts: { teachers, subjects },
    };
  }
}
