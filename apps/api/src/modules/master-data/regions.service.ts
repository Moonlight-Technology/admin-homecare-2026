import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { paginate, skipTake } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, type AuditSource } from '../audit/audit.service';
import type { RegionQueryDto, RegionRowDto } from './dto/master-data.dto';

/**
 * Checks an import batch before anything is written: no duplicate codes, level 1 has no parent, and every
 * other row has a parent exactly one level up (in the batch or already stored). Returns per-row errors.
 */
export function validateRegionRows(rows: RegionRowDto[], stored: Map<string, number>): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  const add = (index: number, message: string) => {
    (errors[`rows.${index}`] ??= []).push(message);
  };
  const levels = new Map<string, number>(stored);
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    if (seen.has(row.code)) add(index, `duplicate code ${row.code} in this file`);
    seen.add(row.code);
    levels.set(row.code, row.level);
  });
  rows.forEach((row, index) => {
    if (row.level === 1) {
      if (row.parentCode) add(index, 'a province (level 1) has no parent');
      return;
    }
    if (!row.parentCode) return add(index, `level ${row.level} needs a parent code`);
    const parentLevel = levels.get(row.parentCode);
    if (parentLevel === undefined) add(index, `parent ${row.parentCode} not found`);
    else if (parentLevel !== row.level - 1) add(index, `parent ${row.parentCode} is level ${parentLevel}, expected ${row.level - 1}`);
  });
  return errors;
}

/** Geographic reference data: looked up and imported, not edited by hand (spec §2). */
@Injectable()
export class RegionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: RegionQueryDto) {
    const where: Prisma.RegionWhereInput = {
      ...(query.level ? { level: query.level } : {}),
      ...(query.parentCode ? { parentCode: query.parentCode } : {}),
      ...(query.search ? { OR: [{ name: { contains: query.search, mode: 'insensitive' } }, { code: { startsWith: query.search } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.region.findMany({ where, orderBy: [{ level: 'asc' }, { code: 'asc' }], ...skipTake(query), include: { parent: { select: { code: true, name: true } } } }),
      this.prisma.region.count({ where }),
    ]);
    return paginate(items, total, query);
  }

  /** All-or-nothing upsert; parents are written before children. */
  async import(rows: RegionRowDto[], source: AuditSource) {
    const parentCodes = [...new Set(rows.map((row) => row.parentCode).filter((code): code is string => Boolean(code)))];
    const stored = new Map(
      (parentCodes.length ? await this.prisma.region.findMany({ where: { code: { in: parentCodes } }, select: { code: true, level: true } }) : []).map((region) => [region.code, region.level]),
    );
    const errors = validateRegionRows(rows, stored);
    if (Object.keys(errors).length) throw AppError.unprocessable('INVALID_REGION_IMPORT', 'Some rows are invalid; nothing was imported.', { fields: errors });

    const ordered = [...rows].sort((a, b) => a.level - b.level);
    const existing = new Set((await this.prisma.region.findMany({ where: { code: { in: rows.map((row) => row.code) } }, select: { code: true } })).map((region) => region.code));
    await this.prisma.$transaction(
      async (tx) => {
        for (const row of ordered) {
          const data = { name: row.name, level: row.level, parentCode: row.parentCode ?? null };
          await tx.region.upsert({ where: { code: row.code }, update: data, create: { code: row.code, ...data } });
        }
        await this.audit.record(source, { event: 'MASTER_REGIONS_IMPORT', entityType: 'Region', after: { rows: rows.length, created: rows.length - existing.size, updated: existing.size } }, tx);
      },
      { timeout: 120_000 },
    );
    return { imported: rows.length, created: rows.length - existing.size, updated: existing.size };
  }
}
