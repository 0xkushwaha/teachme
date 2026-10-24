import { Controller, Get, Header, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { SubjectsService } from './subjects.service';

@ApiTags('subjects')
@Controller('subjects')
export class SubjectsController {
  constructor(private readonly subjects: SubjectsService) {}

  @Public()
  @Get()
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  list() {
    return this.subjects.catalogue();
  }

  @Public()
  @Get(':slug')
  @Header('Cache-Control', 'public, max-age=60')
  get(@Param('slug') slug: string) {
    return this.subjects.bySlug(slug);
  }
}
