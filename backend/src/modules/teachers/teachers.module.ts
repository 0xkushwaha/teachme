import { Module } from '@nestjs/common';
import { TeachersController } from './teachers.controller';
import { TeachersService } from './teachers.service';
import { SubjectsModule } from '../subjects/subjects.module';

@Module({ imports: [SubjectsModule], controllers: [TeachersController], providers: [TeachersService], exports: [TeachersService] })
export class TeachersModule {}
