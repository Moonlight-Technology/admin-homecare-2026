import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { paginate, skipTake } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, type AuditSource } from '../audit/audit.service';
import type { MasterListQueryDto } from './dto/master-data.dto';

type Row = Record<string, unknown> & { id: string; name: string };
type Args = Record<string, unknown>;

/** The Prisma calls shared by every master table; each delegate is narrowed to this shape. */
export type MasterDelegate = {
  findMany(args: Args): Promise<Row[]>;
  count(args: Args): Promise<number>;
  findFirst(args: Args): Promise<Row | null>;
  create(args: Args): Promise<Row>;
  update(args: Args): Promise<Row>;
};

export type MasterResource = {
  /** Audit entity type and event prefix, e.g. `FacilityType` → `MASTER_FACILITY_TYPE_CREATE`. */
  entity: string;
  /** Unique, immutable identifier column: `code`, or `slug` for service categories. */
  keyField: 'code' | 'slug';
  delegate: (prisma: PrismaService) => MasterDelegate;
  include?: Args;
  /** False for tables without a `sortOrder` column; sorting by it falls back to name. */
  hasSortOrder?: boolean;
};

const eventName = (entity: string, action: 'CREATE' | 'UPDATE') => `MASTER_${entity.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}_${action}`;

/**
 * List / create / update for master data (spec §4, AC-ADM-01): server-side search, filters, whitelisted sort,
 * duplicate checks on the key and on the name (case-insensitive), and an audit entry for every change.
 * Records are deactivated rather than deleted, because facilities, offerings, and orders refer to them.
 */
@Injectable()
export class MasterRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(resource: MasterResource, query: MasterListQueryDto, extraWhere: Args = {}) {
    const where: Args = {
      deletedAt: null,
      ...extraWhere,
      ...(query.active === undefined ? {} : { active: query.active }),
      ...(query.search
        ? { OR: [{ name: { contains: query.search, mode: 'insensitive' } }, { [resource.keyField]: { contains: query.search, mode: 'insensitive' } }] }
        : {}),
    };
    // `code` sorting maps to the key column, so categories sort by slug.
    const sortField = query.sortBy === 'code' ? resource.keyField : query.sortBy === 'sortOrder' && resource.hasSortOrder === false ? 'name' : query.sortBy;
    const orderBy = sortField === 'sortOrder' ? [{ sortOrder: query.sortOrder }, { name: 'asc' }] : [{ [sortField]: query.sortOrder }];
    const delegate = resource.delegate(this.prisma);
    const [items, total] = await Promise.all([
      delegate.findMany({ where, orderBy, ...skipTake(query), ...(resource.include ? { include: resource.include } : {}) }),
      delegate.count({ where }),
    ]);
    return paginate(items, total, query);
  }

  async get(resource: MasterResource, id: string) {
    const record = await resource.delegate(this.prisma).findFirst({ where: { id, deletedAt: null }, ...(resource.include ? { include: resource.include } : {}) });
    if (!record) throw AppError.notFound();
    return record;
  }

  async create(resource: MasterResource, data: Args & { name: string }, source: AuditSource) {
    const key = data[resource.keyField] as string;
    await this.assertUnique(resource, key, data.name);
    const created = await this.prisma.$transaction(async (tx) => {
      const record = await resource.delegate(tx as unknown as PrismaService).create({ data, ...(resource.include ? { include: resource.include } : {}) });
      await this.audit.record(source, { event: eventName(resource.entity, 'CREATE'), entityType: resource.entity, entityId: record.id, after: record }, tx);
      return record;
    });
    return created;
  }

  async update(resource: MasterResource, id: string, data: Args & { name?: string }, source: AuditSource) {
    const before = await this.get(resource, id);
    if (data.name !== undefined) await this.assertUnique(resource, null, data.name, id);
    return this.prisma.$transaction(async (tx) => {
      const record = await resource.delegate(tx as unknown as PrismaService).update({ where: { id }, data, ...(resource.include ? { include: resource.include } : {}) });
      await this.audit.record(source, { event: eventName(resource.entity, 'UPDATE'), entityType: resource.entity, entityId: id, before, after: record }, tx);
      return record;
    });
  }

  /** 409 with the offending field, so the form can point at it. The key is checked across deleted rows too. */
  private async assertUnique(resource: MasterResource, key: string | null, name: string, excludeId?: string) {
    const delegate = resource.delegate(this.prisma);
    const notSelf = excludeId ? { id: { not: excludeId } } : {};
    if (key) {
      const taken = await delegate.findFirst({ where: { [resource.keyField]: key, ...notSelf }, select: { id: true } });
      if (taken) throw AppError.conflict('DUPLICATE', `This ${resource.keyField} is already used.`, { fields: { [resource.keyField]: [`${resource.keyField} is already used`] } });
    }
    const sameName = await delegate.findFirst({ where: { name: { equals: name, mode: Prisma.QueryMode.insensitive }, deletedAt: null, ...notSelf }, select: { id: true } });
    if (sameName) throw AppError.conflict('DUPLICATE', 'This name is already used.', { fields: { name: ['name is already used'] } });
  }
}

/** Master tables exposed under /admin/master/*. */
export const MASTER_RESOURCES = {
  facilityTypes: { entity: 'FacilityType', keyField: 'code', delegate: (prisma) => prisma.facilityType as unknown as MasterDelegate },
  clinicClasses: { entity: 'ClinicClass', keyField: 'code', delegate: (prisma) => prisma.clinicClass as unknown as MasterDelegate },
  capabilities: { entity: 'Capability', keyField: 'code', delegate: (prisma) => prisma.capability as unknown as MasterDelegate },
  practitionerTypes: { entity: 'PractitionerType', keyField: 'code', delegate: (prisma) => prisma.practitionerType as unknown as MasterDelegate },
  serviceCategories: { entity: 'ServiceCategory', keyField: 'slug', delegate: (prisma) => prisma.serviceCategory as unknown as MasterDelegate },
  masterServices: {
    entity: 'MasterService',
    keyField: 'code',
    delegate: (prisma) => prisma.masterService as unknown as MasterDelegate,
    include: { category: { select: { id: true, name: true, slug: true, active: true } } },
    hasSortOrder: false,
  },
  documentRequirements: { entity: 'DocumentRequirement', keyField: 'code', delegate: (prisma) => prisma.documentRequirement as unknown as MasterDelegate },
} satisfies Record<string, MasterResource>;
