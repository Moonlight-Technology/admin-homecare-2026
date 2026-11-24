/**
 * Browser regression test only. Intercepts API requests in this isolated browser;
 * never contacts or mutates a real database. Run against `pnpm build` + `pnpm start`.
 * node preview/flow-facilities.mjs (optional WEB_URL / CHROME)
 */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const base = process.env.WEB_URL ?? 'http://localhost:3000';
const type = { id: '00000000-0000-4000-8000-000000000001', code: 'KLINIK', name: 'Klinik' };
const capability = { id: '00000000-0000-4000-8000-000000000002', code: 'RAWAT_JALAN', name: 'Rawat jalan' };
const facilityId = '00000000-0000-4000-8000-000000000003';
const permissions = ['facility:read', 'facility:create', 'facility:update', 'facility:status', 'facility:review'];
let checks = 0;
const check = (name, ok) => { assert.ok(ok, name); checks++; console.log(`PASS ${name}`); };

try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 900 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let readOnly = false;
    let createCount = 0;
    let activationCount = 0;
    let invitationCount = 0;
    let lastQuery;
    let facility = {
      id: facilityId, displayName: 'Klinik Uji', legalName: 'PT Klinik Uji', facilityTypeId: type.id,
      clinicClassId: null, phone: '0215550123', email: null, addressLine: 'Jl. Pengujian 10', postalCode: null,
      capabilities: [capability], facilityType: type, clinicClass: null, verificationStatus: 'DRAFT', operatingStatus: 'INACTIVE',
      statusReason: null, owner: { id: 'owner-test', name: 'Owner Uji', email: 'owner@example.test', status: 'INVITED' },
    };
    await page.setRequestInterception(true);
    page.on('request', async (request) => {
      const url = new URL(request.url());
      if (!url.pathname.startsWith('/api/v1/')) return request.continue();
      const path = url.pathname.replace('/api/v1', '');
      const body = request.postData() ? JSON.parse(request.postData()) : {};
      const respond = (data, status = 200) => request.respond({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': base, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'authorization,content-type,x-facility-id', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS' }, body: status === 204 ? '' : JSON.stringify(data) });
      if (request.method() === 'OPTIONS') return respond(null, 204);
      if (path === '/auth/refresh') return respond({ accessToken: 'isolated-test-token', expiresIn: 900 });
      if (path === '/me') return respond({ user: { id: 'test-admin', name: 'Test Admin', email: 'admin@example.test' }, memberships: [{ id: 'm', scopeType: 'PLATFORM', role: { code: 'PLATFORM_SUPER_ADMIN', name: 'Admin' }, facility: null }], platform: { roles: [], permissions: readOnly ? ['facility:read'] : permissions }, facility: null });
      if (path === '/public/master-options') return respond({ facilityTypes: [type], clinicClasses: [], capabilities: [capability], practitionerTypes: [] });
      if (path === '/admin/facilities' && request.method() === 'GET') {
        lastQuery = url.searchParams;
        return respond({ items: [facility], total: 21, page: Number(lastQuery.get('page') ?? 1), limit: 20 });
      }
      if (path === '/admin/facilities' && request.method() === 'POST') {
        createCount++;
        if (createCount === 1) return respond({ code: 'DUPLICATE', message: 'Email sudah terdaftar', details: { fields: { 'owner.email': ['Gunakan email lain'] } } }, 409);
        facility = { ...facility, ...body.facility, owner: { ...facility.owner, ...body.owner } };
        return respond(facility, 201);
      }
      if (path === `/admin/facilities/${facilityId}` && request.method() === 'PATCH') {
        check(`${width}: blank optional fields sent as null`, body.email === null && body.postalCode === null);
        facility = { ...facility, ...body };
        return respond(facility);
      }
      if (path === `/admin/facilities/${facilityId}`) return respond(facility);
      if (path.endsWith('/resend-invitation')) { invitationCount++; return respond(null, 204); }
      if (path.endsWith('/status')) {
        if (body.action === 'ACTIVATE' && ++activationCount === 1) return respond({ code: 'STATUS_UNCHANGED', message: 'Status berubah, coba lagi' }, 409);
        facility = { ...facility, operatingStatus: body.action === 'ACTIVATE' ? 'ACTIVE' : 'SUSPENDED', statusReason: body.reason ?? null };
        return respond(facility);
      }
      if (path === '/auth/accept-invitation') return body.token === 'expired-test-token-value' ? respond({ code: 'INVALID_INVITATION', message: 'Undangan kedaluwarsa' }, 422) : respond(null, 204);
      return respond({ code: 'TEST_ROUTE_MISSING', message: path }, 404);
    });
    const has = (text) => page.waitForFunction((value) => document.body.innerText.includes(value), { timeout: 10000 }, text);
    const click = async (text, selector = 'button') => {
      const handle = await page.waitForFunction((label, sel) => [...document.querySelectorAll(sel)].find((element) => element.offsetParent !== null && element.textContent.trim() === label), { timeout: 10000 }, text, selector);
      await handle.asElement().click();
    };
    const field = async (label, value) => {
      const handle = await page.waitForFunction((text) => {
        const element = [...document.querySelectorAll('label')].find((item) => item.textContent.replace('*', '').trim() === text);
        return element && document.getElementById(element.htmlFor);
      }, { timeout: 10000 }, label);
      await handle.asElement().focus();
      await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
      await page.keyboard.press('Backspace'); await handle.asElement().type(value);
    };
    const overflow = async (name) => check(`${width}: ${name} has no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

    await page.goto(`${base}/admin/facilities`, { waitUntil: 'networkidle0' });
    await has('Klinik Uji');
    await overflow('list');
    await page.select('[aria-label="Status verifikasi"]', 'VERIFIED');
    await page.waitForNetworkIdle();
    check(`${width}: verification filter reaches API`, lastQuery.get('verificationStatus') === 'VERIFIED');
    await page.click('[aria-label="Halaman berikutnya"]');
    await page.waitForNetworkIdle();
    check(`${width}: server pagination`, lastQuery.get('page') === '2');
    await click('Tambah klinik', 'a');
    await has('Akun pemilik');
    await field('Nama pemilik', 'Owner Baru'); await field('Email pemilik', 'new@example.test');
    await field('Nama tampilan', 'Klinik Baru'); await field('Nama legal', 'PT Klinik Baru');
    const select = await page.$('select'); await select.select(type.id);
    await page.click('[role="checkbox"]');
    await field('Telepon klinik', '0215550123'); await field('Alamat lengkap', 'Jl. Pengujian Baru 20');
    await click('Buat klinik & undang pemilik'); await has('Gunakan email lain');
    check(`${width}: nested owner validation displayed`, true);
    await overflow('create');
    await click('Buat klinik & undang pemilik'); await has('Kirim ulang undangan');
    check(`${width}: create redirects to detail`, page.url().endsWith(facilityId));
    check(`${width}: unverified clinic cannot activate`, await page.evaluate(() => [...document.querySelectorAll('button')].find((item) => item.textContent === 'Aktifkan klinik').disabled));
    await click('Kirim ulang undangan'); await click('Kirim ulang', '[role="dialog"] button'); await has('Undangan baru masuk antrean');
    check(`${width}: resend accepts 204`, invitationCount === 1);
    await field('Nama tampilan', 'Klinik Diperbarui'); await click('Simpan perubahan'); await has('Profil klinik berhasil disimpan.');
    facility.verificationStatus = 'VERIFIED';
    await page.reload({ waitUntil: 'networkidle0' });
    await click('Aktifkan klinik'); await click('Aktifkan', '[role="dialog"] button'); await has('Status berubah, coba lagi');
    check(`${width}: status API errors stay in dialog`, true);
    await click('Aktifkan', '[role="dialog"] button'); await has('Klinik berhasil diaktifkan.');
    await click('Suspend klinik'); await field('Alasan suspend', 'Perbaikan izin klinik');
    await click('Suspend klinik', '[role="dialog"] button'); await has('Klinik berhasil disuspend.');
    check(`${width}: suspend reason persisted`, facility.statusReason === 'Perbaikan izin klinik');
    await overflow('detail');

    readOnly = true;
    await page.reload({ waitUntil: 'networkidle0' }); await has('Anda memiliki akses baca saja.');
    check(`${width}: write controls hidden from reader`, await page.evaluate(() => ![...document.querySelectorAll('button')].some((item) => ['Simpan perubahan', 'Suspend klinik', 'Kirim ulang undangan'].includes(item.textContent))));
    await page.goto(`${base}/admin/facilities/new`, { waitUntil: 'networkidle0' }); await has('Anda tidak memiliki izin menambahkan klinik.');

    await page.goto(`${base}/accept-invitation`, { waitUntil: 'networkidle0' }); await has('Tautan undangan tidak lengkap');
    await page.goto(`${base}/accept-invitation?token=expired-test-token-value`, { waitUntil: 'networkidle0' });
    await field('Password baru', 'Strong-test-password'); await field('Ulangi password', 'Wrong-test-password');
    check(`${width}: mismatched passwords blocked`, await page.evaluate(() => [...document.querySelectorAll('button')].find((item) => item.textContent === 'Aktifkan akun').disabled));
    await field('Ulangi password', 'Strong-test-password'); await click('Aktifkan akun'); await has('Undangan kedaluwarsa');
    await page.goto(`${base}/accept-invitation?token=valid-test-token-value`, { waitUntil: 'networkidle0' });
    await field('Password baru', 'Strong-test-password'); await field('Ulangi password', 'Strong-test-password');
    await click('Aktifkan akun'); await has('Akun berhasil diaktifkan.');
    await overflow('invitation');
    check(`${width}: no browser runtime errors`, errors.length === 0);
    await page.close();
  }
  console.log(`${checks} checks passed. Isolated API fixtures only; not a live integration test.`);
} finally {
  await browser.close();
}
