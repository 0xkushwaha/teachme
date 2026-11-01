import { Controller, Get, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../common/decorators';
import { AppError } from '../../common/errors';
import { PrismaService } from '../../database/prisma.service';
import { FilesService } from './files.service';

/** Public teacher photos. Only AVATAR files are reachable here; documents never are. */
@ApiTags('files')
@Controller('files')
export class FilesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

  @Public()
  @Get('avatars/:id')
  async avatar(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const f = await this.prisma.storedFile.findFirst({ where: { id, kind: 'AVATAR' }, select: { fileName: true, mimeType: true, data: true, sha256: true } });
    if (!f) throw AppError.notFound('File');
    this.files.send(res, f, { inline: true, cache: 'public-immutable' });
  }
}
