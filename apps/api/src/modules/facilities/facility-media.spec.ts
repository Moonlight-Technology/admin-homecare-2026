import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { DocumentsService } from '../documents/documents.service';
import { FacilityMediaService, MAX_FACILITY_PHOTOS } from './facility-media.service';

type Media = { id: string; facilityId: string; documentId: string; kind: 'LOGO' | 'PHOTO'; caption: string | null; sortOrder: number; createdAt: Date };

/** In-memory facility_media table; the transaction callback receives the same client (rollback is not simulated). */
function setup(initial: Media[] = []) {
  const rows = new Map(initial.map((row) => [row.id, { ...row }]));
  let nextId = 0;
  const matches = (row: Media, where: Partial<Media>) => Object.entries(where).every(([key, value]) => row[key as keyof Media] === value);
  const shape = (row: Media) => ({ ...row, document: { id: row.documentId, fileName: `${row.documentId}.jpg`, mimeType: 'image/jpeg', sizeBytes: 10 } });
  const facilityMedia = {
    findMany: jest.fn(async ({ where }: { where: Partial<Media> }) => [...rows.values()].filter((row) => matches(row, where)).sort((a, b) => a.sortOrder - b.sortOrder).map(shape)),
    findFirst: jest.fn(async ({ where }: { where: Partial<Media> }) => [...rows.values()].find((row) => matches(row, where)) ?? null),
    count: jest.fn(async ({ where }: { where: Partial<Media> }) => [...rows.values()].filter((row) => matches(row, where)).length),
    aggregate: jest.fn(async ({ where }: { where: Partial<Media> }) => {
      const orders = [...rows.values()].filter((row) => matches(row, where)).map((row) => row.sortOrder);
      return { _max: { sortOrder: orders.length ? Math.max(...orders) : null } };
    }),
    create: jest.fn(async ({ data }: { data: Omit<Media, 'id' | 'createdAt'> }) => {
      const row = { ...data, id: `m${++nextId}`, createdAt: new Date() } as Media;
      rows.set(row.id, row);
      return shape(row);
    }),
    update: jest.fn(async ({ where, data }: { where: { id: string }; data: Partial<Media> }) => { const row = rows.get(where.id)!; Object.assign(row, data); return shape(row); }),
    delete: jest.fn(async ({ where }: { where: { id: string } }) => { rows.delete(where.id); }),
  };
  const locks: string[] = [];
  const db = {
    facilityMedia,
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, table: { text?: string; strings?: string[] }, facilityId: string) => {
      locks.push(`${(table.strings ?? [table.text]).join('')}:${facilityId}`);
      return facilityId === 'missing' ? [] : [{ id: facilityId }];
    }),
  };
  const prisma = { ...db, $transaction: jest.fn(async (callback: (tx: typeof db) => Promise<unknown>) => callback(db)) };
  const documents = {
    initMediaUpload: jest.fn(async () => ({ document: { id: 'new-doc' }, upload: {} })),
    completeUpload: jest.fn(async () => undefined),
    deleteOwned: jest.fn(async (_owner: unknown, documentId: string) => `facility-media/f1/${documentId}`),
    removeObjects: jest.fn(async () => undefined),
    downloadLink: jest.fn((documentId: string) => ({ url: `https://api.test/documents/${documentId}/content?token=t`, expiresAt: 'soon' })),
  };
  const audit = { record: jest.fn() };
  const config = { getOrThrow: () => 'postgresql://user@localhost/db?schema=clinic_test' } as unknown as ConfigService;
  const service = new FacilityMediaService(prisma as unknown as PrismaService, documents as unknown as DocumentsService, audit as unknown as AuditService, config);
  return { service, rows, documents, audit, locks };
}

const source = { actorId: 'u1', scope: 'FACILITY' as const };
const photo = (index: number, facilityId = 'f1'): Media => ({ id: `p${index}`, facilityId, documentId: `d${index}`, kind: 'PHOTO', caption: null, sortOrder: index, createdAt: new Date() });

describe('FacilityMediaService', () => {
  it('lists media with signed display links and no storage keys', async () => {
    const { service } = setup([photo(0)]);
    const result = await service.list('f1');
    expect(result.maxPhotos).toBe(MAX_FACILITY_PHOTOS);
    expect(result.items).toEqual([expect.objectContaining({ id: 'p0', kind: 'PHOTO', fileName: 'd0.jpg', url: expect.stringContaining('/documents/d0/content?token=') })]);
    expect(JSON.stringify(result)).not.toMatch(/objectKey|facility-media\//);
  });

  it('refuses a photo upload once the gallery is full, but still accepts a logo', async () => {
    const { service, documents } = setup(Array.from({ length: MAX_FACILITY_PHOTOS }, (_, index) => photo(index)));
    const file = { fileName: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 10 };
    await expect(service.initUpload('f1', { kind: 'PHOTO', ...file }, 'u1')).rejects.toMatchObject({ code: 'MEDIA_LIMIT_REACHED' });
    await service.initUpload('f1', { kind: 'LOGO', ...file }, 'u1');
    expect(documents.initMediaUpload).toHaveBeenCalledWith('f1', file, 'u1');
  });

  it('appends a completed photo after the last one, under a facility lock, with an audit entry', async () => {
    const { service, documents, audit, locks } = setup([photo(0), photo(3)]);
    const created = await service.complete('f1', { documentId: 'new-doc', kind: 'PHOTO', caption: 'Ruang tunggu' }, source);
    expect(locks).toEqual(['"clinic_test"."facilities":f1']);
    expect(documents.completeUpload).toHaveBeenCalledWith({ ownerType: 'FACILITY_MEDIA', ownerId: 'f1' }, 'new-doc', source, expect.anything());
    expect(created).toMatchObject({ kind: 'PHOTO', sortOrder: 4, caption: 'Ruang tunggu' });
    expect(audit.record).toHaveBeenCalledWith(source, expect.objectContaining({ event: 'FACILITY_MEDIA_ADDED', facilityId: 'f1' }), expect.anything());
    expect(documents.removeObjects).toHaveBeenCalledWith([]);
  });

  it('re-checks the photo limit when completing (concurrent uploads)', async () => {
    const { service } = setup(Array.from({ length: MAX_FACILITY_PHOTOS }, (_, index) => photo(index)));
    await expect(service.complete('f1', { documentId: 'new-doc', kind: 'PHOTO' }, source)).rejects.toMatchObject({ code: 'MEDIA_LIMIT_REACHED' });
  });

  it('replaces the previous logo and removes its bytes only after commit', async () => {
    const logo: Media = { id: 'l1', facilityId: 'f1', documentId: 'old-logo', kind: 'LOGO', caption: null, sortOrder: 0, createdAt: new Date() };
    const { service, rows, documents } = setup([logo]);
    await service.complete('f1', { documentId: 'new-doc', kind: 'LOGO' }, source);
    expect([...rows.values()].filter((row) => row.kind === 'LOGO').map((row) => row.documentId)).toEqual(['new-doc']);
    expect(documents.deleteOwned).toHaveBeenCalledWith({ ownerType: 'FACILITY_MEDIA', ownerId: 'f1' }, 'old-logo', expect.anything());
    expect(documents.removeObjects).toHaveBeenCalledWith(['facility-media/f1/old-logo']);
  });

  it('reorders only with the complete list of current photos', async () => {
    const { service, rows } = setup([photo(0), photo(1), photo(2)]);
    await expect(service.reorder('f1', ['p2', 'p0'], source)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(service.reorder('f1', ['p2', 'p0', 'x'], source)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const result = await service.reorder('f1', ['p2', 'p0', 'p1'], source);
    expect(result.items.map((item) => item.id)).toEqual(['p2', 'p0', 'p1']);
    expect(rows.get('p2')!.sortOrder).toBe(0);
  });

  it('answers 404 for media of another clinic and never touches it', async () => {
    const { service, rows, documents } = setup([photo(0, 'other')]);
    await expect(service.remove('f1', 'p0', source)).rejects.toMatchObject({ status: 404 });
    await expect(service.updateCaption('f1', 'p0', 'x', source)).rejects.toMatchObject({ status: 404 });
    expect(rows.has('p0')).toBe(true);
    expect(documents.deleteOwned).not.toHaveBeenCalled();
  });

  it('removes a photo, its document and then its bytes', async () => {
    const { service, rows, documents, audit } = setup([photo(0)]);
    await service.remove('f1', 'p0', source);
    expect(rows.size).toBe(0);
    expect(documents.removeObjects).toHaveBeenCalledWith(['facility-media/f1/d0']);
    expect(audit.record).toHaveBeenCalledWith(source, expect.objectContaining({ event: 'FACILITY_MEDIA_REMOVED' }), expect.anything());
  });
});
