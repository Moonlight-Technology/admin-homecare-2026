/** Isolated staff browser regression; all API requests are intercepted, never a real database/email.
 * Build/start admin-web, then `node preview/flow-staff.mjs` (WEB_URL / CHROME optional).
 */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const base = process.env.WEB_URL ?? 'http://localhost:3000';
let checks = 0;
const check = (name, ok) => { assert.ok(ok, name); checks++; console.log(`PASS ${name}`); };
const roles = [
  { code: 'CLINIC_OWNER_ADMIN', name: 'Owner / admin klinik', permissions: ['staff:read', 'staff:manage', 'clinic:profile:read'] },
  { code: 'CLINIC_STAFF', name: 'Staf operasional', permissions: ['order:read', 'order:assign'] },
];

try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 900 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let readOnly = false;
    let denied = false;
    let creates = 0;
    let updates = 0;
    let resends = 0;
    let accessWrites = 0;
    let allScoped = true;
    let query;
    const self = { id: 'owner-membership', facilityId: 'clinic-a', active: true, createdAt: new Date().toISOString(), user: { id: 'owner-user', name: 'Owner Sendiri', email: 'owner@example.test', status: 'ACTIVE' }, role: roles[0] };
    let member = { id: 'staff-membership', facilityId: 'clinic-a', active: true, createdAt: new Date().toISOString(), user: { id: 'staff-user', name: 'Staf Uji', email: 'staff@example.test', status: 'ACTIVE' }, role: roles[1] };
    await page.setRequestInterception(true);
    page.on('request', async (request) => {
      const url = new URL(request.url());
      if (!url.pathname.startsWith('/api/v1/')) return request.continue();
      const path = url.pathname.replace('/api/v1', '');
      const body = request.postData() ? JSON.parse(request.postData()) : {};
      const respond = (data, status = 200) => request.respond({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': base, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'authorization,content-type,x-facility-id', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS' }, body: status === 204 ? '' : JSON.stringify(data) });
      if (request.method() === 'OPTIONS') return respond(null, 204);
      if (path === '/auth/refresh') return respond({ accessToken: 'isolated-token', expiresIn: 900 });
      if (path === '/me') return respond({ user: self.user, memberships: [{ id: self.id, scopeType: 'FACILITY', role: roles[0], facility: { id: 'clinic-a', displayName: 'Klinik A', verificationStatus: 'VERIFIED', operatingStatus: 'ACTIVE' } }], platform: null, facility: { facilityId: 'clinic-a', role: 'CLINIC_OWNER_ADMIN', permissions: denied ? [] : readOnly ? ['staff:read'] : ['staff:read', 'staff:manage'] } });
      if (path.startsWith('/clinic/staff')) allScoped &&= request.headers()['x-facility-id'] === 'clinic-a';
      if (path === '/clinic/staff/roles') return respond(roles);
      if (path === '/clinic/staff' && request.method() === 'GET') { query = url.searchParams; return respond({ items: [self, member], total: 21 }); }
      if (path === '/clinic/staff' && request.method() === 'POST') {
        if (++creates === 1) return respond({ code: 'DUPLICATE', message: 'Email sudah terdaftar', details: { fields: { email: ['Gunakan email baru'] } } }, 409);
        member = { ...member, user: { ...member.user, name: body.name, email: body.email, status: 'INVITED' }, role: roles.find((role) => role.code === body.roleCode) }; return respond(member, 201);
      }
      if (path === '/clinic/staff/staff-membership' && request.method() === 'PATCH') {
        if (++updates === 1) return respond({ code: 'CONCURRENT_CHANGE', message: 'Data berubah, coba lagi' }, 409);
        member = { ...member, role: roles.find((role) => role.code === body.roleCode) }; return respond(member);
      }
      if (path === '/clinic/staff/staff-membership') return respond(member);
      if (path === '/clinic/staff/owner-membership') return respond(self);
      if (path.endsWith('/resend-invitation')) { resends++; return respond(null, 204); }
      if (path.endsWith('/access')) { accessWrites++; member = { ...member, active: body.action === 'ENABLE' }; return respond(member); }
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
      await handle.asElement().click(); await has('Detail staf klinik');
    };
    const overflow = async (name) => check(`${width}: ${name} no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

    await page.goto(`${base}/clinic/staff`, { waitUntil: 'networkidle0' }); await has('Staf Uji'); await overflow('list');
    await page.type('[aria-label="Cari staf"]', 'staf'); await page.waitForNetworkIdle();
    check(`${width}: search reaches API`, query.get('search') === 'staf');
    await page.select('[aria-label="Akses staf"]', 'INACTIVE'); await page.select('[aria-label="Role staf"]', 'CLINIC_STAFF'); await page.waitForNetworkIdle();
    check(`${width}: access and role filters`, query.get('access') === 'INACTIVE' && query.get('roleCode') === 'CLINIC_STAFF');
    await page.click('[aria-label="Halaman berikutnya"]'); await page.waitForNetworkIdle(); check(`${width}: pagination`, query.get('page') === '2');
    await openDetail('Owner Sendiri'); await has('Role dan akses akun sendiri tidak dapat diubah.');
    check(`${width}: self role locked`, await page.$eval('[role="dialog"] select', (element) => element.disabled));
    await click('Tutup', '[role="dialog"] button');
    await click('Tambah staf'); await field('Nama staf', 'Staf Baru'); await field('Email staf', 'new@example.test');
    await has('order:read'); check(`${width}: selected role permissions displayed`, true);
    await click('Tambah staf', '[role="dialog"] button'); await has('Gunakan email baru'); check(`${width}: duplicate email field error`, true);
    await overflow('invite'); await click('Tambah staf', '[role="dialog"] button'); await has('Staf ditambahkan.');
    check(`${width}: new account remains invited`, member.user.status === 'INVITED');
    await click('Kirim ulang undangan'); await click('Buat ulang undangan', '[role="dialog"] button'); await has('Undangan baru masuk antrean');
    check(`${width}: queued resend accepts 204`, resends === 1);
    await openDetail('Staf Baru'); check(`${width}: global identity is read-only`, await page.$eval('[role="dialog"] input', (element) => element.disabled));
    await page.select('[role="dialog"] select', 'CLINIC_OWNER_ADMIN'); await has('Owner/admin memiliki akses');
    await click('Simpan role'); await has('Data berubah, coba lagi'); check(`${width}: role conflict shown`, true);
    await click('Simpan role'); await has('Role staf berhasil diperbarui.'); check(`${width}: role saved`, member.role.code === 'CLINIC_OWNER_ADMIN');
    await click('Nonaktifkan akses'); await field('Alasan perubahan akses', 'Kontrak staf berakhir'); await click('Nonaktifkan akses', '[role="dialog"] button'); await page.waitForNetworkIdle();
    check(`${width}: disables membership only`, !member.active && member.user.status === 'INVITED');
    await click('Aktifkan akses'); await field('Alasan perubahan akses', 'Kontrak diperpanjang'); await click('Aktifkan akses', '[role="dialog"] button'); await page.waitForNetworkIdle();
    check(`${width}: re-enable does not bypass activation`, accessWrites === 2 && member.active && member.user.status === 'INVITED');
    readOnly = true; await page.reload({ waitUntil: 'networkidle0' }); await has('Staf Baru');
    check(`${width}: reader write actions hidden`, await page.evaluate(() => ![...document.querySelectorAll('button')].some((element) => element.offsetParent !== null && ['Tambah staf', 'Nonaktifkan akses', 'Kirim ulang undangan'].includes(element.textContent.trim()))));
    await openDetail('Staf Baru'); await has('Anda memiliki akses baca saja'); check(`${width}: reader cannot change role`, await page.$eval('[role="dialog"] select', (element) => element.disabled));
    await overflow('detail');
    denied = true; await page.reload({ waitUntil: 'networkidle0' }); await has('Anda tidak memiliki izin melihat staf klinik.');
    check(`${width}: requests carry own facility scope`, allScoped); check(`${width}: no browser runtime errors`, errors.length === 0);
    await page.close();
  }
  console.log(`${checks} checks passed with isolated API fixtures. Not a live database/email integration test.`);
} finally { await browser.close(); }
