import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, Public, Roles } from '../../common/decorators';
import type { AuthUser } from '../../common/auth-user';
import { AppError } from '../../common/errors';
import { AvailabilityService } from './availability.service';
import { CreateExceptionDto, ReplaceWeeklyDto, SlotsQuery, TeachingSettingsDto } from './dto/availability.dto';

@ApiTags('availability')
@Controller('availability')
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  /** Bookable slots (UTC) for a teacher. Not cached: availability must reflect live bookings. */
  @Public()
  @Get('teachers/:teacherId/slots')
  slots(@Param('teacherId', ParseUUIDPipe) teacherId: string, @Query() q: SlotsQuery) {
    return this.availability.slots(teacherId, q.from, q.to, q.durationMinutes);
  }

  @Roles('TEACHER')
  @Get('me')
  mine(@CurrentUser() user: AuthUser) {
    return this.availability.getMine(teacherId(user));
  }

  @Roles('TEACHER')
  @Put('me/weekly')
  weekly(@CurrentUser() user: AuthUser, @Body() dto: ReplaceWeeklyDto) {
    return this.availability.replaceWeekly(teacherId(user), dto.windows);
  }

  @Roles('TEACHER')
  @Post('me/exceptions')
  addException(@CurrentUser() user: AuthUser, @Body() dto: CreateExceptionDto) {
    return this.availability.addException(teacherId(user), dto);
  }

  @Roles('TEACHER')
  @HttpCode(204)
  @Delete('me/exceptions/:id')
  async removeException(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.availability.removeException(teacherId(user), id);
  }

  @Roles('TEACHER')
  @Patch('me/settings')
  settings(@CurrentUser() user: AuthUser, @Body() dto: TeachingSettingsDto) {
    return this.availability.updateSettings(teacherId(user), dto);
  }
}

export function teacherId(user: AuthUser): string {
  if (!user.teacherProfileId) throw AppError.forbidden('Teacher profile required');
  return user.teacherProfileId;
}
