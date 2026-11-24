/**
 * Browser regression test only. Intercepts API requests in this isolated browser; never contacts or mutates a real
 * database or storage. Run against `pnpm build` + `pnpm start`:
 * node preview/flow-facility-media.mjs (optional WEB_URL / CHROME)
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const base = process.env.WEB_URL ?? 'http://localhost:3000';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
const type = { id: '00000000-0000-4000-8000-000000000001', code: 'KLINIK', name: 'Klinik' };
const facilityId = '00000000-0000-4000-8000-000000000003';
const dir = await mkdtemp(join(tmpdir(), 'nakes-media-flow-'));
const files = { png: join(dir, 'logo.png'), photo: join(dir, 'foto.png'), gif: join(dir, 'animasi.gif'), big: join(dir, 'besar.png') };
await writeFile(files.png, PNG); await writeFile(files.photo, PNG); await writeFile(files.gif, Buffer.from('GIF89a'));
await writeFile(files.big, Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]));
let checks = 0;
const check = (name, ok) => { assert.ok(ok, name); checks++; console.log(`PASS ${name}`); };

try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 900 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let role = 'owner';
    let maxPhotos = 3;
    let items = [];
    let next = 0;
    const calls = [];
    const facility = { id: facilityId, displayName: 'Klinik Uji', legalName: 'PT Klinik Uji', facilityTypeId: type.id, clinicClassId: null, phone: '0215550123', email: null, addressLine: 'Jl. Pengujian 10', postalCode: null, capabilities: [], facilityType: type, clinicClass: null, verificationStatus: 'UNDER_REVIEW', operatingStatus: 'INACTIVE', statusReason: null, owner: null };
    const list = () => ({ maxPhotos, items: [...items].sort((a, b) => (a.kind === b.kind ? a.sortOrder - b.sortOrder : a.kind === 'LOGO' ? -1 : 1)) });
    const media = (kind, documentId) => ({ id: `m${++next}`, kind, caption: null, sortOrder: kind === 'LOGO' ? 0 : items.filter((item) => item.kind === 'PHOTO').length, fileName: `${documentId}.png`, mimeType: 'image/png', sizeBytes: PNG.length, url: `${base.replace('3000', '4000')}/api/v1/documents/${documentId}/content?token=signed`, expiresAt: new Date(Date.now() + 300_000).toISOString() });
    await page.setRequestInterception(true);
    page.on('request', async (request) => {
      const url = new URL(request.url());
      if (!url.pathname.startsWith('/api/v1/')) return request.continue();
      const path = url.pathname.replace('/api/v1', '');
      const method = request.method();
      const cors = { 'Access-Control-Allow-Origin': base, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'authorization,content-type,x-facility-id', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS' };
      const respond = (data, status = 200) => request.respond({ status, contentType: 'application/json', headers: cors, body: status === 204 ? '' : JSON.stringify(data) });
      if (method === 'OPTIONS') return respond(null, 204);
      if (method !== 'GET' || path.includes('/media') || path.startsWith('/documents/')) calls.push(`${method} ${path}`);
      const body = request.postData() && !path.startsWith('/documents/') ? JSON.parse(request.postData()) : {};
      if (path === '/auth/refresh') return respond({ accessToken: 'isolated-test-token', expiresIn: 900 });
      if (path === '/me') {
        if (role === 'platform') return respond({ user: { id: 'u-admin', name: 'Admin', email: 'admin@example.test' }, memberships: [{ id: 'm', scopeType: 'PLATFORM', role: { code: 'PLATFORM_OPERATOR', name: 'Operator' }, facility: null }], platform: { roles: [], permissions: ['facility:read'] }, facility: null });
        return respond({ user: { id: 'u1', name: 'Owner Uji', email: 'owner@example.test' }, memberships: [{ id: 'm', scopeType: 'FACILITY', role: { code: 'CLINIC_OWNER_ADMIN', name: 'Owner' }, facility: { id: facilityId, displayName: 'Klinik Uji', verificationStatus: 'UNDER_REVIEW', operatingStatus: 'INACTIVE' } }], platform: null, facility: { facilityId, role: 'CLINIC_OWNER_ADMIN', permissions: ['clinic:profile:read', ...(role === 'owner' ? ['clinic:profile:update'] : [])] } });
      }
      if (path === '/public/master-options') return respond({ facilityTypes: [type], clinicClasses: [], capabilities: [], practitionerTypes: [] });
      if (path === '/clinic/profile' || path === `/admin/facilities/${facilityId}`) return respond(facility);
      if (path === '/clinic/profile/media' || path === `/admin/facilities/${facilityId}/media`) return respond(list());
      if (path === '/clinic/profile/media/upload-init') return respond({ document: { id: `doc-${next + 1}` }, upload: { method: 'PUT', url: `${base.replace('3000', '4000')}/api/v1/documents/doc-${next + 1}/upload?token=signed`, headers: { 'Content-Type': body.mimeType } } }, 201);
      if (/^\/documents\/[^/]+\/upload$/.test(path)) return respond(null, 204);
      if (/^\/documents\/[^/]+\/content$/.test(path)) return request.respond({ status: 200, contentType: 'image/png', headers: cors, body: PNG });
      if (path === '/clinic/profile/media/complete') {
        if (body.kind === 'LOGO') items = items.filter((item) => item.kind !== 'LOGO');
        const created = media(body.kind, body.documentId); items.push(created); return respond(created);
      }
      if (path === '/clinic/profile/media/order') { body.ids.forEach((id, index) => { items.find((item) => item.id === id).sortOrder = index; }); return respond(list()); }
      const match = path.match(/^\/clinic\/profile\/media\/(m\d+)$/);
      if (match && method === 'PATCH') { const item = items.find((entry) => entry.id === match[1]); item.caption = body.caption; return respond(item); }
      if (match && method === 'DELETE') { items = items.filter((entry) => entry.id !== match[1]); return respond(null, 204); }
      return respond({ code: 'TEST_ROUTE_MISSING', message: path }, 404);
    });
    const has = (text) => page.waitForFunction((value) => document.body.innerText.includes(value), { timeout: 10000 }, text)
      .catch(async (error) => { if (process.env.FLOW_DEBUG_DIR) await page.screenshot({ path: join(process.env.FLOW_DEBUG_DIR, `media-${width}.png`), fullPage: true }); throw new Error(`${width}: "${text}" not shown (${error.message})`); });
    const button = (label) => page.evaluate((text) => [...document.querySelectorAll('button')].some((element) => element.offsetParent !== null && element.textContent.trim() === text), label);
    const click = async (label, scope = 'button') => {
      const handle = await page.waitForFunction((text, sel) => [...document.querySelectorAll(sel)].find((element) => element.offsetParent !== null && element.textContent.trim() === text), { timeout: 10000 }, label, scope)
        .catch(async (error) => { if (process.env.FLOW_DEBUG_DIR) await page.screenshot({ path: join(process.env.FLOW_DEBUG_DIR, `media-${width}.png`), fullPage: true }); throw new Error(`${width}: button "${label}" not found (${error.message})`); });
      await press(handle.asElement());
    };
    // Centre before clicking: on mobile the sticky header would otherwise cover an element scrolled to the top edge.
    async function press(element) { await element.evaluate((node) => node.scrollIntoView({ block: 'center' })); await element.click(); }
    const choose = async (label, file) => { const input = await page.$(`input[aria-label="${label}"]`); await input.uploadFile(file); };
    const overflow = async (label) => check(`${width}/${label}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    const blobImage = (alt) => page.waitForFunction((text) => document.querySelector(`img[alt="${text}"]`)?.src.startsWith('blob:'), { timeout: 10000 }, alt);

    await page.goto(`${base}/clinic/profile`, { waitUntil: 'networkidle0' });
    await has('Logo dan foto klinik'); await has('Belum ada foto');
    check(`${width}: media stays editable while verification is under review`, Boolean(await button('Unggah logo')) && await page.evaluate(() => document.body.innerText.includes('Profil dikunci sementara')));
    await overflow('empty media');

    await choose('Pilih file foto', files.gif); await has('Hanya gambar JPG atau PNG');
    await choose('Pilih file foto', files.big); await has('Ukuran gambar harus 1 byte sampai 5 MB.');
    check(`${width}: invalid files are rejected before any request`, !calls.some((call) => call.includes('upload-init')));

    await choose('Pilih file logo', files.png); await has('Logo klinik disimpan.'); await blobImage('Logo klinik');
    const upload = calls.filter((call) => /upload-init|\/upload$|complete/.test(call));
    check(`${width}: logo goes through init, signed PUT and complete in order`, upload.length === 3 && upload[0].endsWith('upload-init') && upload[1].startsWith('PUT /documents/') && upload[2].endsWith('complete'));
    check(`${width}: logo shown from a fetched blob, not a direct API image URL`, await page.evaluate(() => !document.querySelector('img[src*="/api/v1/"]')));

    for (let index = 0; index < 3; index++) { await choose('Pilih file foto', files.photo); await has('Foto ditambahkan.'); await page.waitForFunction((count) => document.body.innerText.includes(`Foto (${count}/3)`), { timeout: 10000 }, index + 1); }
    await blobImage('Foto 1');
    check(`${width}: full gallery disables adding photos`, await page.evaluate(() => [...document.querySelectorAll('button')].find((element) => element.textContent.trim() === 'Tambah foto')?.disabled === true) && await page.evaluate(() => document.body.innerText.includes('Batas foto tercapai')));

    await page.type('input[aria-label="Keterangan Foto 1"]', 'Ruang tunggu'); await click('Simpan'); await has('Keterangan foto disimpan.');
    check(`${width}: caption saved through PATCH`, items.find((item) => item.kind === 'PHOTO' && item.sortOrder === 0).caption === 'Ruang tunggu');
    const firstId = items.find((item) => item.kind === 'PHOTO' && item.sortOrder === 0).id;
    await press(await page.$('button[aria-label="Geser Ruang tunggu ke kanan"]'));
    await page.waitForFunction(() => document.querySelector('button[aria-label="Geser Ruang tunggu ke kiri"]:not([disabled])'), { timeout: 10000 });
    check(`${width}: reorder sends the complete photo list`, calls.includes('PUT /clinic/profile/media/order') && items.find((item) => item.id === firstId).sortOrder === 1);

    await press(await page.$('button[aria-label="Hapus Ruang tunggu"]')); await has('Hapus foto?');
    await click('Hapus', '[role="dialog"] button'); await has('Foto dihapus.');
    check(`${width}: photo deleted after confirmation`, !items.some((item) => item.id === firstId) && calls.some((call) => call === `DELETE /clinic/profile/media/${firstId}`));
    await click('Hapus logo'); await click('Hapus', '[role="dialog"] button'); await has('Logo dihapus.');
    check(`${width}: logo removal reports the logo`, !items.some((item) => item.kind === 'LOGO'));
    await overflow('filled media');

    role = 'staff';
    await page.goto(`${base}/clinic/profile`, { waitUntil: 'networkidle0' }); await has('Logo dan foto klinik'); await blobImage('Foto 1');
    check(`${width}: staff without profile update sees no media actions`, !(await button('Tambah foto')) && !(await button('Unggah logo')) && !(await page.$('input[aria-label^="Keterangan"]')));

    role = 'platform';
    await page.goto(`${base}/admin/facilities/${facilityId}`, { waitUntil: 'networkidle0' }); await has('Logo dan foto klinik'); await blobImage('Foto 1');
    check(`${width}: platform view is read-only`, !(await button('Tambah foto')) && await page.evaluate(() => document.body.innerText.includes('Hanya dapat dilihat')));
    await overflow('platform media');
    check(`${width}: no browser runtime errors`, errors.length === 0);
    await page.close();
  }
  console.log(`RESULT ${checks} isolated browser checks passed.`);
} finally {
  await browser.close();
  await rm(dir, { recursive: true, force: true });
}
