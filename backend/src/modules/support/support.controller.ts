import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, Public } from '../../common/decorators';
import type { AuthUser } from '../../common/auth-user';
import { PrismaService } from '../../database/prisma.service';
import { CreateTicketDto } from './dto/support.dto';

@ApiTags('support')
@Controller('support/tickets')
export class SupportController {
  constructor(private readonly prisma: PrismaService) {}

  /** Contact form / booking issue report. Works signed-in or anonymously. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @Post()
  async create(@CurrentUser() user: AuthUser | undefined, @Body() dto: CreateTicketDto) {
    let bookingId = dto.bookingId ?? null;
    if (bookingId && user) {
      const b = await this.prisma.booking.findUnique({ where: { id: bookingId }, select: { studentId: true, teacher: { select: { userId: true } } } });
      if (!b || (b.studentId !== user.id && b.teacher.userId !== user.id)) bookingId = null;
    } else if (!user) {
      bookingId = null;
    }
    const t = await this.prisma.supportTicket.create({ data: { ...dto, bookingId, userId: user?.id ?? null } });
    return { id: t.id, status: t.status, createdAt: t.createdAt };
  }

  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.prisma.supportTicket.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, category: true, subject: true, status: true, bookingId: true, createdAt: true, updatedAt: true },
    });
  }
}
