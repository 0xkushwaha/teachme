import { Prisma } from '@prisma/client';

/** Postgres SQLSTATE 23P01 = exclusion_violation (our booking overlap constraints). */
export function isExclusionViolation(err: unknown, constraint?: string): boolean {
  const pgCode = extractPgCode(err);
  if (pgCode !== '23P01') return false;
  if (!constraint) return true;
  return String((err as Error).message ?? '').includes(constraint);
}

export function isUniqueViolation(err: unknown): boolean {
  return (
    (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') || extractPgCode(err) === '23505'
  );
}

function extractPgCode(err: unknown): string | undefined {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // Raw query failures surface as P2010 with the SQLSTATE in meta.code; exclusion
    // violations from regular queries surface as P2004 or unknown errors carrying the code text.
    const metaCode = (err.meta as { code?: string } | undefined)?.code;
    if (metaCode) return metaCode;
    if (/23P01|exclusion constraint/i.test(err.message)) return '23P01';
    if (err.code === 'P2002') return '23505';
  }
  if (err instanceof Prisma.PrismaClientUnknownRequestError) {
    if (/23P01|exclusion constraint/i.test(err.message)) return '23P01';
  }
  if (err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string') {
    return (err as { code: string }).code;
  }
  return undefined;
}
