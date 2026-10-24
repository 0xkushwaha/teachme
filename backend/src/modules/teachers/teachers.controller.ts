import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsUUID, Max, Min } from 'class-validator';
import { CurrentUser, Public, Roles } from '../../common/decorators';
import type { AuthUser } from '../../common/auth-user';
import { teacherId } from '../availability/availability.controller';
import { TeachersService } from './teachers.service';
import { ReplaceTeacherSubjectsDto, SearchTeachersQuery, UpdateTeacherProfileDto } from './dto/teachers.dto';

class QuoteQuery {
  @IsUUID()
  subjectId: string;

  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(240)
  durationMinutes: number;
}

@ApiTags('teachers')
@Controller('teachers')
export class TeachersController {
  constructor(private readonly teachers: TeachersService) {}

  @Public()
  @Get()
  search(@Query() q: SearchTeachersQuery) {
    return this.teachers.search(q);
  }

  @Roles('TEACHER')
  @Get('me')
  mine(@CurrentUser() user: AuthUser) {
    return this.teachers.mine(teacherId(user));
  }

  @Roles('TEACHER')
  @Patch('me')
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateTeacherProfileDto) {
    return this.teachers.updateProfile(teacherId(user), dto);
  }

  @Roles('TEACHER')
  @Put('me/subjects')
  subjects(@CurrentUser() user: AuthUser, @Body() dto: ReplaceTeacherSubjectsDto) {
    return this.teachers.replaceSubjects(teacherId(user), dto);
  }

  @Roles('TEACHER')
  @Get('me/overview')
  overview(@CurrentUser() user: AuthUser) {
    return this.teachers.overview(teacherId(user), user.id);
  }

  @Public()
  @Get(':id/quote')
  quote(@Param('id', ParseUUIDPipe) id: string, @Query() q: QuoteQuery) {
    return this.teachers.quote(id, q.subjectId, q.durationMinutes);
  }

  @Public()
  @Get(':slug')
  profile(@Param('slug') slug: string) {
    return this.teachers.publicProfile(slug);
  }
}
