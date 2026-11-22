import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ACCESS_KEY, type AccessRule } from '../../common/access/access.decorators';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateMasterServiceDto, CreateServiceCategoryDto, CreateTaxonomyDto, ImportRegionsDto } from './dto/master-data.dto';
import * as controllers from './master-data.controllers';
import { MASTER_RESOURCES, MasterRecordsService, type MasterDelegate } from './master-records.service';
import { RegionsService, validateRegionRows } from './regions.service';

const source = { actorId: 'admin-1', scope: 'PLATFORM' as const };

function setup(findFirst: (args: { where: Record<string, unknown> }) => unknown = () => null) {
  const calls: Record<string, unknown[]> = { findMany: [], create: [], update: [] };
  const delegate = {
    findMany: jest.fn(async (args: unknown) => { calls.findMany!.push(args); return []; }),
    count: jest.fn(async () => 0),
    findFirst: jest.fn(async (args: { where: Record<string, unknown> }) => findFirst(args)),
    create: jest.fn(async (args: { data: Record<string, unknown> }) => { calls.create!.push(args); return { id: 'new-id', ...args.data }; }),
    update: jest.fn(async (args: { data: Record<string, unknown> }) => { calls.update!.push(args); return { id: 'row-1', name: 'Updated', ...args.data }; }),
  };
  void (delegate as unknown as MasterDelegate);
  const prisma = { facilityType: delegate, serviceCategory: delegate } as Record<string, unknown>;
  prisma.$transaction = jest.fn(async (run: (tx: unknown) => unknown) => run(prisma));
  const audit = { record: jest.fn(async () => undefined) };
  const service = new MasterRecordsService(prisma as unknown as PrismaService, audit as unknown as AuditService);
  return { service, delegate, calls, audit };
}

describe('MasterRecordsService (AC-ADM-01)', () => {
  it('creates a record and audits it in the same transaction', async () => {
    const { service, audit } = setup();
    const created = await service.create(MASTER_RESOURCES.facilityTypes, { code: 'KLINIK', name: 'Klinik' }, source);
    expect(created).toMatchObject({ id: 'new-id', code: 'KLINIK' });
    expect(audit.record).toHaveBeenCalledWith(source, expect.objectContaining({ event: 'MASTER_FACILITY_TYPE_CREATE', entityType: 'FacilityType', entityId: 'new-id' }), expect.anything());
  });

  it('rejects a duplicate code with the field name', async () => {
    const { service, delegate } = setup((args) => ('code' in args.where ? { id: 'other' } : null));
    await expect(service.create(MASTER_RESOURCES.facilityTypes, { code: 'KLINIK', name: 'Klinik baru' }, source)).rejects.toMatchObject({
      code: 'DUPLICATE',
      details: { fields: { code: ['code is already used'] } },
    });
    expect(delegate.create).not.toHaveBeenCalled();
  });

  it('rejects a duplicate name regardless of case', async () => {
    const { service } = setup((args) => ('name' in args.where ? { id: 'other' } : null));
    await expect(service.create(MASTER_RESOURCES.facilityTypes, { code: 'KLINIK_2', name: 'klinik' }, source)).rejects.toMatchObject({ details: { fields: { name: ['name is already used'] } } });
  });

  it('uses the slug as the key for service categories', async () => {
    const { service } = setup((args) => ('slug' in args.where ? { id: 'other' } : null));
    await expect(service.create(MASTER_RESOURCES.serviceCategories, { slug: 'laboratorium', name: 'Lab' }, source)).rejects.toMatchObject({ details: { fields: { slug: ['slug is already used'] } } });
  });

  it('returns 404 when updating a missing or deleted record', async () => {
    const { service } = setup(() => null);
    await expect(service.update(MASTER_RESOURCES.facilityTypes, 'missing', { name: 'X' }, source)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('allows keeping its own name on update and records before/after', async () => {
    const existing = { id: 'row-1', code: 'KLINIK', name: 'Klinik' };
    const { service, audit } = setup((args) => (args.where.id === 'row-1' ? existing : null));
    await service.update(MASTER_RESOURCES.facilityTypes, 'row-1', { name: 'Klinik', active: false }, source);
    expect(audit.record).toHaveBeenCalledWith(source, expect.objectContaining({ event: 'MASTER_FACILITY_TYPE_UPDATE', before: existing }), expect.anything());
  });

  it('lists live rows with search, active filter, and whitelisted sort', async () => {
    const { service, calls } = setup();
    await service.list(MASTER_RESOURCES.serviceCategories, { page: 2, limit: 10, search: 'lab', active: true, sortBy: 'code', sortOrder: 'asc' });
    expect(calls.findMany![0]).toMatchObject({
      where: { deletedAt: null, active: true, OR: [{ name: { contains: 'lab' } }, { slug: { contains: 'lab' } }] },
      orderBy: [{ slug: 'asc' }],
      skip: 10,
      take: 10,
    });
  });

  it('sorts master services by name, since they have no sortOrder column', async () => {
    const findMany = jest.fn(async (_args: unknown) => []);
    const prisma = { masterService: { findMany, count: jest.fn(async () => 0) } };
    const service = new MasterRecordsService(prisma as unknown as PrismaService, {} as AuditService);
    await service.list(MASTER_RESOURCES.masterServices, { page: 1, limit: 20, sortBy: 'sortOrder', sortOrder: 'desc' });
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({ orderBy: [{ name: 'desc' }] });
  });
});

describe('master data DTOs', () => {
  const errorsOf = async (cls: new () => object, plain: object) => (await validate(plainToInstance(cls, plain))).map((error) => error.property);

  it('normalises codes and slugs before validating them', async () => {
    const taxonomy = plainToInstance(CreateTaxonomyDto, { code: ' rawat jalan ', name: ' Rawat jalan ' });
    expect(taxonomy).toMatchObject({ code: 'RAWAT_JALAN', name: 'Rawat jalan' });
    expect(plainToInstance(CreateServiceCategoryDto, { slug: 'Konsultasi Fertilitas', name: 'Fertilitas' }).slug).toBe('konsultasi-fertilitas');
  });

  it('rejects malformed codes, short names, and bad references', async () => {
    expect(await errorsOf(CreateTaxonomyDto, { code: '!x', name: 'A' })).toEqual(expect.arrayContaining(['code', 'name']));
    expect(await errorsOf(CreateMasterServiceDto, { code: 'LAB_1', name: 'Lab', categoryId: 'not-a-uuid' })).toEqual(['categoryId']);
  });

  it('caps region imports at 5000 rows', async () => {
    const rows = Array.from({ length: 5001 }, (_, index) => ({ code: String(index + 10), name: 'Wilayah', level: 1 }));
    expect(await errorsOf(ImportRegionsDto, { rows })).toEqual(['rows']);
  });
});

describe('validateRegionRows', () => {
  it('accepts a batch whose parents come earlier in the file or already exist', () => {
    const rows = [
      { code: '31', name: 'DKI Jakarta', level: 1 },
      { code: '31.71', name: 'Jakarta Pusat', level: 2, parentCode: '31' },
      { code: '32.01', name: 'Bogor', level: 2, parentCode: '32' },
    ];
    expect(validateRegionRows(rows, new Map([['32', 1]]))).toEqual({});
  });

  it('reports duplicates, missing parents, and level mismatches per row', () => {
    const errors = validateRegionRows(
      [
        { code: '31', name: 'DKI', level: 1, parentCode: '99' },
        { code: '31', name: 'DKI again', level: 1 },
        { code: '31.71', name: 'Jakpus', level: 3, parentCode: '31' },
        { code: '31.71.01', name: 'Gambir', level: 3, parentCode: '31.99' },
        { code: '31.72', name: 'Jakut', level: 2 },
      ],
      new Map(),
    );
    expect(errors['rows.0']).toEqual(['a province (level 1) has no parent']);
    expect(errors['rows.1']).toEqual(['duplicate code 31 in this file']);
    expect(errors['rows.2']).toEqual(['parent 31 is level 1, expected 2']);
    expect(errors['rows.3']).toEqual(['parent 31.99 not found']);
    expect(errors['rows.4']).toEqual(['level 2 needs a parent code']);
  });
});

describe('master data controllers', () => {
  const all = Object.values(controllers) as Array<new (...args: never[]) => object>;

  it('resolves dependencies for every controller, including the generated ones', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: all,
      providers: [MasterRecordsService, RegionsService, { provide: PrismaService, useValue: {} }, { provide: AuditService, useValue: {} }],
    }).compile();
    for (const controller of all) expect(moduleRef.get(controller)).toBeInstanceOf(controller);
  });

  it('guards reads with master:read and writes with master:write', () => {
    // The public options endpoint is checked separately below.
    for (const controller of all.filter((candidate) => candidate !== controllers.PublicMasterOptionsController)) {
      for (const name of Object.getOwnPropertyNames(controller.prototype).filter((key) => key !== 'constructor' && !key.startsWith('assert'))) {
        const rule = Reflect.getMetadata(ACCESS_KEY, controller.prototype[name as keyof object]) as AccessRule | undefined;
        expect(rule?.kind).toBe('platform');
        const expected = ['list', 'get'].includes(name) ? 'master:read' : 'master:write';
        expect(rule && 'permissions' in rule ? rule.permissions : []).toEqual([expected]);
      }
    }
  });

  it('exposes only the read-only options endpoint publicly', () => {
    const rule = Reflect.getMetadata(ACCESS_KEY, controllers.PublicMasterOptionsController.prototype.options) as AccessRule;
    expect(rule.kind).toBe('public');
    expect(Object.getOwnPropertyNames(controllers.PublicMasterOptionsController.prototype)).toEqual(['constructor', 'options']);
  });
});
