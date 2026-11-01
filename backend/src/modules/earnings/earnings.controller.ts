import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser, Roles } from '../../common/decorators';
import type { AuthUser } from '../../common/auth-user';
import { PaginationQuery } from '../../common/dto/pagination.dto';
import { teacherId } from '../availability/availability.controller';
import { EarningsService } from './earnings.service';

export class PayoutRequestDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/** A teacher's own earnings and payouts. Ownership comes from the session, never from the URL. */
@ApiTags('earnings')
@Roles('TEACHER')
@Controller('teachers/me')
export class EarningsController {
  constructor(private readonly earnings: EarningsService) {}

  @Get('earnings')
  summary(@CurrentUser() user: AuthUser) {
    return this.earnings.summary(teacherId(user));
  }

  @Get('earnings/series')
  series(@CurrentUser() user: AuthUser) {
    return this.earnings.series(teacherId(user));
  }

  @Get('earnings/ledger')
  ledger(@CurrentUser() user: AuthUser, @Query() q: PaginationQuery) {
    return this.earnings.ledger(teacherId(user), q);
  }

  @Get('payouts')
  payouts(@CurrentUser() user: AuthUser, @Query() q: PaginationQuery) {
    return this.earnings.payouts(teacherId(user), q);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('payouts')
  request(@CurrentUser() user: AuthUser, @Body() dto: PayoutRequestDto) {
    teacherId(user);
    return this.earnings.requestPayout(user, dto.note);
  }

  @HttpCode(200)
  @Post('payouts/:id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    teacherId(user);
    return this.earnings.cancelPayout(user, id);
  }
}
