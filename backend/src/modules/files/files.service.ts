import { Injectable } from '@nestjs/common';
import { FileKind } from '@prisma/client';
import { createHash } from 'crypto';
import type { Response } from 'express';
import { Tx } from '../../database/prisma.service';
import { AppError, ErrorCode } from '../../common/errors';
import { looksLikeMarkup, safeFileName, SniffedType, sniffFileType } from '../../utils/file-signature';

export interface UploadedBlob {
  buffer: Buffer;
  originalname?: string;
  size: number;
}

export const FILE_RULES: Record<FileKind, { maxBytes: number; types: SniffedType[] }> = {
  TEACHER_DOCUMENT: { maxBytes: 5 * 1024 * 1024, types: ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'] },
  AVATAR: { maxBytes: 2 * 1024 * 1024, types: ['image/png', 'image/jpeg', 'image/webp'] },
};

/** Columns safe to select in lists (everything except the bytes). */
export const FILE_META = { id: true, kind: true, fileName: true, mimeType: true, sizeBytes: true, sha256: true, createdAt: true } as const;

@Injectable()
export class FilesService {
  /** Validates by content (magic bytes), never by the client's filename or Content-Type. */
  validate(file: UploadedBlob | undefined, kind: FileKind) {
    if (!file?.buffer?.length) throw AppError.badRequest(ErrorCode.VALIDATION_FAILED, 'Choose a file to upload');
    const rules = FILE_RULES[kind];
    if (file.buffer.length > rules.maxBytes)
      throw AppError.badRequest(ErrorCode.VALIDATION_FAILED, `File is too large (max ${Math.round(rules.maxBytes / 1024 / 1024)} MB)`);
    const type = sniffFileType(file.buffer);
    if (!type || !rules.types.includes(type))
      throw AppError.badRequest(ErrorCode.VALIDATION_FAILED, `Unsupported file type. Allowed: ${rules.types.map((t) => t.split('/')[1].toUpperCase()).join(', ')}`);
    if (type !== 'application/pdf' && looksLikeMarkup(file.buffer))
      throw AppError.badRequest(ErrorCode.VALIDATION_FAILED, 'This image could not be accepted. Please export it again and retry.');
    return { type, fileName: safeFileName(file.originalname, type) };
  }

  async store(tx: Tx, ownerId: string, kind: FileKind, file: UploadedBlob) {
    const { type, fileName } = this.validate(file, kind);
    return tx.storedFile.create({
      data: {
        ownerId,
        kind,
        fileName,
        mimeType: type,
        sizeBytes: file.buffer.length,
        sha256: createHash('sha256').update(file.buffer).digest('hex'),
        data: new Uint8Array(file.buffer),
      },
      select: FILE_META,
    });
  }

  /**
   * Writes file bytes with headers that stop the browser from sniffing or executing them.
   * Documents are always downloads; avatars may render inline as images.
   */
  send(res: Response, file: { fileName: string; mimeType: string; data: Uint8Array; sha256: string }, opts: { inline: boolean; cache: 'private' | 'public-immutable' }) {
    const disposition = opts.inline ? 'inline' : 'attachment';
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', String(file.data.length));
    res.setHeader('Content-Disposition', `${disposition}; filename="${file.fileName.replace(/[^\w.\- ]/g, '_')}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('ETag', `"${file.sha256}"`);
    res.setHeader('Cache-Control', opts.cache === 'public-immutable' ? 'public, max-age=31536000, immutable' : 'private, no-store');
    if (opts.cache === 'public-immutable') res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.end(Buffer.from(file.data));
  }
}
