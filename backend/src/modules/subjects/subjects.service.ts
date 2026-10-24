import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { isUniqueViolation } from '../../database/prisma-errors';
import { AppError, ErrorCode } from '../../common/errors';
import { RedisService } from '../../services/redis.service';
import { slugify } from '../../utils/slug';
import { UpsertCategoryDto, UpsertSubjectDto } from './dto/subjects.dto';

const CACHE_KEY = 'cache:subjects:v1';

@Injectable()
export class SubjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Public catalogue (cached briefly — contains no private data). */
  async catalogue() {
    const cached = await this.redis.getJson<unknown>(CACHE_KEY).catch(() => null);
    if (cached) return cached;
    const [categories, counts] = await Promise.all([
      this.prisma.subjectCategory.findMany({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: { subjects: { where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] } },
      }),
      this.prisma.teacherSubject.groupBy({
        by: ['subjectId'],
        where: { isActive: true, teacher: { approvalStatus: 'APPROVED', user: { status: 'ACTIVE' } } },
        _count: { _all: true },
        _min: { hourlyRateMinor: true },
      }),
    ]);
    const bySubject = new Map(counts.map((c) => [c.subjectId, c]));
    const result = {
      categories: categories.map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        subjects: c.subjects.map((s) => ({
          id: s.id,
          slug: s.slug,
          name: s.name,
          description: s.description,
          teacherCount: bySubject.get(s.id)?._count._all ?? 0,
          fromHourlyRateMinor: bySubject.get(s.id)?._min.hourlyRateMinor ?? null,
        })),
      })),
    };
    await this.redis.setJson(CACHE_KEY, result, 60).catch(() => undefined);
    return result;
  }

  async bySlug(slug: string) {
    const s = await this.prisma.subject.findFirst({ where: { slug, isActive: true }, include: { category: true } });
    if (!s) throw AppError.notFound('Subject');
    return { id: s.id, slug: s.slug, name: s.name, description: s.description, category: { slug: s.category.slug, name: s.category.name } };
  }

  async invalidate() {
    await this.redis.client.del(CACHE_KEY);
  }

  // ---- admin ----
  async listAll() {
    return this.prisma.subject.findMany({
      orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
      include: { category: { select: { id: true, name: true } }, _count: { select: { teachers: true, bookings: true } } },
    });
  }

  async create(dto: UpsertSubjectDto) {
    try {
      const s = await this.prisma.subject.create({ data: { ...dto, slug: dto.slug ?? slugify(dto.name) } });
      await this.invalidate();
      return s;
    } catch (err) {
      if (isUniqueViolation(err)) throw AppError.conflict(ErrorCode.CONFLICT, 'A subject with that slug exists');
      throw err;
    }
  }

  async update(id: string, dto: Partial<UpsertSubjectDto>) {
    const s = await this.prisma.subject.update({ where: { id }, data: dto }).catch((err) => {
      if (isUniqueViolation(err)) throw AppError.conflict(ErrorCode.CONFLICT, 'A subject with that slug exists');
      throw AppError.notFound('Subject');
    });
    await this.invalidate();
    return s;
  }

  async categories() {
    return this.prisma.subjectCategory.findMany({ orderBy: { sortOrder: 'asc' }, include: { _count: { select: { subjects: true } } } });
  }

  async createCategory(dto: UpsertCategoryDto) {
    const c = await this.prisma.subjectCategory.create({ data: { name: dto.name, slug: dto.slug ?? slugify(dto.name), sortOrder: dto.sortOrder ?? 0 } }).catch((err) => {
      if (isUniqueViolation(err)) throw AppError.conflict(ErrorCode.CONFLICT, 'A category with that slug exists');
      throw err;
    });
    await this.invalidate();
    return c;
  }

  async updateCategory(id: string, dto: Partial<UpsertCategoryDto>) {
    const c = await this.prisma.subjectCategory.update({ where: { id }, data: dto }).catch(() => {
      throw AppError.notFound('Category');
    });
    await this.invalidate();
    return c;
  }
}
