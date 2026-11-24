/**
 * Clinic profile media over real HTTP + PostgreSQL, run from practitioner-documents.mjs inside its random isolated
 * schema and temporary local storage:
 * SMOKE_ALLOW_ISOLATED_SCHEMA=1 SMOKE_ONLY_FACILITY_MEDIA=1 node --env-file=.env test/smoke/practitioner-documents.mjs
 */
import { randomUUID } from 'node:crypto';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 0x20)]);

export async function facilityMedia({ database, a, b, admin, reader, expect, call, check }) {
  const file = (bytes, mimeType = 'image/png', name = 'foto.png') => ({ fileName: name, mimeType, sizeBytes: bytes.length });
  async function upload(token, kind, bytes = PNG, mimeType = 'image/png') {
    const init = await expect('POST', '/clinic/profile/media/upload-init', token, { kind, ...file(bytes, mimeType) }, 201, `${kind} upload initialised`);
    const put = await fetch(init.upload.url, { method: 'PUT', headers: init.upload.headers, body: bytes, signal: AbortSignal.timeout(45_000) });
    await put.arrayBuffer();
    check(`${kind} bytes accepted (HTTP ${put.status})`, put.status === 204);
    return init;
  }
  const complete = (token, documentId, kind, status = 200, name = `${kind} attached`, caption) =>
    expect('POST', '/clinic/profile/media/complete', token, { documentId, kind, ...(caption ? { caption } : {}) }, status, name);
  const photos = async () => (await database.facilityMedia.findMany({ where: { facilityId: a.id, kind: 'PHOTO' }, orderBy: { sortOrder: 'asc' } })).map((row) => row.id);

  const empty = await expect('GET', '/clinic/profile/media', a.token, undefined, 200, 'clinic lists its media');
  check('new clinic has no media and a photo limit', empty.items.length === 0 && empty.maxPhotos === 8);
  await expect('POST', '/clinic/profile/media/upload-init', a.token, { kind: 'PHOTO', fileName: 'brosur.pdf', mimeType: 'application/pdf', sizeBytes: 100 }, 422, 'PDF rejected as clinic media');
  await expect('POST', '/clinic/profile/media/upload-init', a.token, { kind: 'PHOTO', ...file(PNG), sizeBytes: 5 * 1024 * 1024 + 1 }, 422, 'image over 5 MB rejected');
  await expect('POST', '/clinic/profile/media/upload-init', a.token, { kind: 'BANNER', ...file(PNG) }, 422, 'unknown media kind rejected');

  // Logo: upload, cross-clinic denial, signed display link, separation from verification documents.
  const logo = await upload(a.token, 'LOGO');
  check('storage key is never returned', !JSON.stringify(logo).includes('objectKey'));
  await complete(b.token, logo.document.id, 'LOGO', 404, 'another clinic cannot attach the upload');
  const attached = await complete(a.token, logo.document.id, 'LOGO');
  const shown = await fetch(attached.url);
  check('signed logo link returns the exact bytes', shown.status === 200 && Buffer.from(await shown.arrayBuffer()).equals(PNG));
  const verificationDocs = await expect('GET', '/clinic/documents', a.token, undefined, 200, 'verification document list still works');
  check('media never appears among verification documents', !verificationDocs.some((document) => document.id === logo.document.id));
  check('verification lists keep ignoring FACILITY_MEDIA', (await database.document.findUnique({ where: { id: logo.document.id } })).ownerType === 'FACILITY_MEDIA');

  // A new logo replaces the old one; concurrent replacements still leave exactly one logo.
  const second = await upload(a.token, 'LOGO');
  await complete(a.token, second.document.id, 'LOGO', 200, 'second logo replaces the first');
  check('replaced logo document is deleted', (await database.document.findUnique({ where: { id: logo.document.id } })) === null);
  const [x, y] = [await upload(a.token, 'LOGO'), await upload(a.token, 'LOGO')];
  const raced = await Promise.all([x, y].map((init) => call('POST', '/clinic/profile/media/complete', a.token, { documentId: init.document.id, kind: 'LOGO' })));
  check('concurrent logo replacements both commit in turn', raced.every((result) => result.status === 200));
  check('exactly one logo remains after concurrent replacements', await database.facilityMedia.count({ where: { facilityId: a.id, kind: 'LOGO' } }) === 1);
  let duplicateLogo = false;
  try {
    const document = await database.document.create({ data: { ownerType: 'FACILITY_MEDIA', ownerId: a.id, objectKey: `facility-media/${a.id}/${randomUUID()}`, fileName: 'x.png', mimeType: 'image/png', sizeBytes: 1, status: 'UPLOADED' } });
    await database.facilityMedia.create({ data: { facilityId: a.id, documentId: document.id, kind: 'LOGO' } });
  } catch (error) { duplicateLogo = error?.code === 'P2002'; }
  check('database index refuses a second logo row', duplicateLogo);

  // Photos: caption, append order, JPEG, cross-clinic isolation.
  const p1 = await upload(a.token, 'PHOTO');
  const first = await complete(a.token, p1.document.id, 'PHOTO', 200, 'photo attached with caption', 'Ruang tunggu');
  const p2 = await upload(a.token, 'PHOTO', JPEG, 'image/jpeg');
  const secondPhoto = await complete(a.token, p2.document.id, 'PHOTO');
  check('photos are appended in order with their caption', first.sortOrder === 0 && secondPhoto.sortOrder === 1 && first.caption === 'Ruang tunggu');
  await expect('PATCH', `/clinic/profile/media/${first.id}`, a.token, { caption: 'Lobi klinik' }, 200, 'caption updated');
  await expect('PATCH', `/clinic/profile/media/${first.id}`, b.token, { caption: 'x' }, 404, 'another clinic cannot edit the caption');
  await expect('DELETE', `/clinic/profile/media/${first.id}`, b.token, undefined, 404, 'another clinic cannot delete the photo');
  check('other clinic sees none of these media', (await expect('GET', '/clinic/profile/media', b.token, undefined, 200, 'other clinic lists its own media')).items.length === 0);

  // Reorder needs the full current list.
  await expect('PUT', '/clinic/profile/media/order', a.token, { ids: [secondPhoto.id] }, 422, 'partial reorder rejected');
  const reordered = await expect('PUT', '/clinic/profile/media/order', a.token, { ids: [secondPhoto.id, first.id] }, 200, 'full reorder accepted');
  check('reorder is persisted', reordered.items.filter((item) => item.kind === 'PHOTO').map((item) => item.id).join() === [secondPhoto.id, first.id].join());

  // Limit: fill to 7 directly, then two concurrent completions can only add one more.
  for (let index = (await photos()).length; index < 7; index++) {
    const document = await database.document.create({ data: { ownerType: 'FACILITY_MEDIA', ownerId: a.id, objectKey: `facility-media/${a.id}/${randomUUID()}`, fileName: 'fixture.png', mimeType: 'image/png', sizeBytes: 1, status: 'UPLOADED' } });
    await database.facilityMedia.create({ data: { facilityId: a.id, documentId: document.id, kind: 'PHOTO', sortOrder: 10 + index } });
  }
  const [c1, c2] = [await upload(a.token, 'PHOTO'), await upload(a.token, 'PHOTO')];
  const limited = await Promise.all([c1, c2].map((init) => call('POST', '/clinic/profile/media/complete', a.token, { documentId: init.document.id, kind: 'PHOTO' })));
  check('concurrent completions at the limit add exactly one photo', limited.map((result) => result.status).sort().join() === '200,409' && (await photos()).length === 8);
  await expect('POST', '/clinic/profile/media/upload-init', a.token, { kind: 'PHOTO', ...file(PNG) }, 409, 'full gallery refuses another upload');

  // Removal deletes the record and its document; platform view is read-only and permission-checked.
  await expect('DELETE', `/clinic/profile/media/${first.id}`, a.token, undefined, 204, 'photo removed');
  check('removed photo and its document are gone', !(await database.facilityMedia.findUnique({ where: { id: first.id } })) && !(await database.document.findUnique({ where: { id: p1.document.id } })));
  const platform = await expect('GET', `/admin/facilities/${a.id}/media`, admin, undefined, 200, 'platform admin views clinic media');
  check('platform view lists logo and photos with signed links', platform.items.filter((item) => item.kind === 'LOGO').length === 1 && platform.items.every((item) => item.url.includes('token=')));
  await expect('GET', `/admin/facilities/${a.id}/media`, reader, undefined, 403, 'platform user without facility:read is denied');
  await expect('GET', `/admin/facilities/${randomUUID()}/media`, admin, undefined, 404, 'unknown clinic answers 404');
  const audit = await database.auditLog.findMany({ where: { facilityId: a.id, event: { startsWith: 'FACILITY_MEDIA_' } }, select: { event: true, actorId: true } });
  check('media changes are audited with actor and clinic scope', ['FACILITY_MEDIA_ADDED', 'FACILITY_MEDIA_UPDATED', 'FACILITY_MEDIA_REORDERED', 'FACILITY_MEDIA_REMOVED'].every((event) => audit.some((entry) => entry.event === event && entry.actorId)));
}
