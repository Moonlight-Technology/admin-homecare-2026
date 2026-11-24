/** Isolated browser regression with intercepted API fixtures, never a live database.
 * Start a production web build, then run `node preview/flow-users.mjs` (WEB_URL/CHROME optional).
 */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const base = process.env.WEB_URL ?? 'http://localhost:3000';
let count = 0;
const check = (name, ok) => { assert.ok(ok, name); count++; console.log(`PASS ${name}`); };
const membership = (code) => [{ id: 'membership', role: { code, name: code === 'PLATFORM_SUPER_ADMIN' ? 'Super admin' : 'Operator platform' } }];

try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 900 });
    const runtimeErrors = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    let readOnly = false;
    let query;
    let creates = 0;
    let resends = 0;
    let edits = 0;
    let statusWrites = 0;
    const self = { id: 'self', name: 'Admin Sendiri', email: 'self@example.test', status: 'ACTIVE', createdAt: new Date().toISOString(), lastLoginAt: null, memberships: membership('PLATFORM_SUPER_ADMIN') };
    let user = { id: 'other', name: 'Operator Uji', email: 'operator@example.test', status: 'ACTIVE', createdAt: new Date().toISOString(), lastLoginAt: null, memberships: membership('PLATFORM_OPERATOR') };
    await page.setRequestInterception(true);
    page.on('request', async (request) => {
      const url = new URL(request.url());
      if (!url.pathname.startsWith('/api/v1/')) return request.continue();
      const path = url.pathname.replace('/api/v1', '');
      const body = request.postData() ? JSON.parse(request.postData()) : {};
      const respond = (data, status = 200) => request.respond({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': base, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'authorization,content-type,x-facility-id', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS' }, body: status === 204 ? '' : JSON.stringify(data) });
      if (request.method() === 'OPTIONS') return respond(null, 204);
      if (path === '/auth/refresh') return respond({ accessToken: 'test-only-token', expiresIn: 900 });
      if (path === '/me') return respond({ user: self, memberships: [{ id: 'm', scopeType: 'PLATFORM', role: { code: 'PLATFORM_SUPER_ADMIN', name: 'Admin' }, facility: null }], platform: { roles: ['PLATFORM_SUPER_ADMIN'], permissions: readOnly ? ['platform-user:read'] : ['platform-user:read', 'platform-user:manage'] }, facility: null });
      if (path === '/admin/users' && request.method() === 'GET') { query = url.searchParams; return respond({ items: [self, user], total: 21 }); }
      if (path === '/admin/users' && request.method() === 'POST') {
        if (++creates === 1) return respond({ code: 'DUPLICATE', message: 'Email sudah terdaftar', details: { fields: { email: ['Gunakan email lain'] } } }, 409);
        user = { ...user, ...body, status: 'INVITED', memberships: membership(body.roleCode) }; return respond(user, 201);
      }
      if (path === '/admin/users/other' && request.method() === 'PATCH') { edits++; user = { ...user, name: body.name, memberships: membership(body.roleCode) }; return respond(user); }
      if (path === '/admin/users/other') return respond(user);
      if (path === '/admin/users/self') return respond(self);
      if (path.endsWith('/resend-invitation')) { resends++; return respond(null, 204); }
      if (path.endsWith('/status')) { statusWrites++; user = { ...user, status: body.action === 'DISABLE' ? 'DISABLED' : body.action === 'SUSPEND' ? 'SUSPENDED' : 'ACTIVE' }; return respond(user); }
      return respond({ code: 'TEST_ROUTE_MISSING', message: path }, 404);
    });
    const has = (text) => page.waitForFunction((value) => document.body.innerText.includes(value), { timeout: 10000 }, text);
    const click = async (text, selector = 'button') => {
      const handle = await page.waitForFunction((label, sel) => [...document.querySelectorAll(sel)].find((element) => element.offsetParent !== null && element.textContent.trim() === label), { timeout: 10000 }, text, selector);
      await handle.asElement().click();
    };
    const field = async (label, value) => {
      const handle = await page.waitForFunction((text) => {
        const element = [...document.querySelectorAll('[role="dialog"] label')].find((item) => item.textContent.replace('*', '').trim() === text);
        return element && document.getElementById(element.htmlFor);
      }, { timeout: 10000 }, label);
      await handle.asElement().focus(); await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace'); await handle.asElement().type(value);
    };
    const openDetail = async (name) => {
      const handle = await page.waitForFunction((label) => [...document.querySelectorAll(`[aria-label="Detail ${label}"]`)].find((element) => element.offsetParent !== null), { timeout: 10000 }, name);
      await handle.asElement().click(); await has('Detail pengguna');
    };
    const overflow = async (name) => check(`${width}: ${name} no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

    await page.goto(`${base}/admin/users`, { waitUntil: 'networkidle0' }); await has('Operator Uji');
    await overflow('list');
    await page.type('[aria-label="Cari pengguna"]', 'operator'); await page.waitForNetworkIdle();
    check(`${width}: search sent to API`, query.get('search') === 'operator');
    await page.select('[aria-label="Status pengguna"]', 'ACTIVE'); await page.waitForNetworkIdle();
    await page.select('[aria-label="Role pengguna"]', 'PLATFORM_OPERATOR'); await page.waitForNetworkIdle();
    check(`${width}: status and role filters`, query.get('status') === 'ACTIVE' && query.get('roleCode') === 'PLATFORM_OPERATOR');
    await page.click('[aria-label="Halaman berikutnya"]'); await page.waitForNetworkIdle();
    check(`${width}: pagination`, query.get('page') === '2');
    await openDetail('Admin Sendiri');
    await has('Role akun sendiri tidak dapat diubah.');
    check(`${width}: self role disabled`, await page.$eval('[role="dialog"] select', (element) => element.disabled));
    await click('Tutup', '[role="dialog"] button');
    await click('Undang pengguna'); await field('Nama pengguna', 'Operator Baru'); await field('Email', 'new@example.test');
    await click('Buat undangan', 'button'); await has('Gunakan email lain');
    check(`${width}: duplicate email error displayed`, true);
    await overflow('invite'); await click('Buat undangan'); await has('Operator Baru');
    await click('Kirim ulang undangan'); await click('Kirim ulang', '[role="dialog"] button'); await has('Undangan aktivasi masuk antrean');
    check(`${width}: resend 204`, resends === 1);
    await openDetail('Operator Baru'); await field('Nama pengguna', 'Operator Edit');
    await page.select('[role="dialog"] select', 'PLATFORM_SUPER_ADMIN'); await click('Simpan perubahan'); await has('Operator Edit');
    check(`${width}: name and role saved`, edits === 1 && user.memberships[0].role.code === 'PLATFORM_SUPER_ADMIN');
    await click('Nonaktifkan'); await field('Alasan perubahan status', 'Review akses pengguna');
    await click('Nonaktifkan pengguna', '[role="dialog"] button'); await has('Status pengguna berhasil diperbarui.');
    check(`${width}: disable action`, user.status === 'DISABLED');
    await click('Aktifkan kembali'); await field('Alasan perubahan status', 'Review sudah selesai'); await click('Aktifkan kembali', '[role="dialog"] button'); await page.waitForNetworkIdle();
    await click('Suspend'); await field('Alasan perubahan status', 'Review akses lanjutan'); await click('Suspend pengguna', '[role="dialog"] button'); await page.waitForNetworkIdle();
    check(`${width}: enable and suspend actions`, statusWrites === 3 && user.status === 'SUSPENDED');
    readOnly = true; await page.reload({ waitUntil: 'networkidle0' }); await has('Operator Edit');
    check(`${width}: reader has no invite or status controls`, await page.evaluate(() => ![...document.querySelectorAll('button')].some((element) => element.offsetParent !== null && ['Undang pengguna', 'Aktifkan kembali', 'Nonaktifkan'].includes(element.textContent.trim()))));
    await openDetail('Operator Edit'); await has('Anda memiliki akses baca saja');
    check(`${width}: reader cannot edit identity`, await page.$eval('[role="dialog"] input', (element) => element.disabled));
    await overflow('detail'); check(`${width}: no runtime errors`, runtimeErrors.length === 0);
    await page.close();
  }
  console.log(`${count} checks passed with isolated API fixtures. Not a live integration test.`);
} finally { await browser.close(); }
