/** Browser regression with isolated HTTP fixtures, not a live database/payment/notification test. */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const base = process.env.WEB_URL ?? 'http://localhost:3000';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
let checks = 0;
const check = (name, condition) => { assert.ok(condition, name); checks++; console.log(`PASS ${name}`); };
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 900 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let writable = true;
    let progress = false;
    let tooEarly = false;
    let slotFailure = false;
    let emptySlots = false;
    let moveConflict = false;
    let conflict = false;
    let writes = 0;
    let order;
    let filterStatus;
    const reset = (status) => { order = {
      id: 'o1', version: 0, code: 'NK-TEST-CANCEL', facilityId: 'f1', status, assignmentStatus: 'ASSIGNED', paymentStatus: 'NOT_CONFIGURED',
      mode: 'ON_SITE', scheduledAt: '2026-12-01T01:00:00Z', timezone: 'Asia/Jakarta', currency: 'IDR', createdAt: '2026-11-24T01:00:00Z',
      itemSubtotal: '50000', feeTotal: '0', grandTotal: '50000', durationMinutes: 30, rejectionReason: null, slotId: status === 'PENDING_APPROVAL' ? null : 's1',
      facility: { id: 'f1', displayName: 'Klinik Uji' }, facilitySnapshot: { displayName: 'Klinik Uji', addressLine: 'Jl Uji', phone: null },
      patient: { name: 'Pasien Uji', phone: null, sex: null, birthYear: null }, address: null,
      items: [{ id: 'i1', offeringId: 'off1', nameSnapshot: 'Layanan Uji', priceSnapshot: '50000', durationMinutes: 30, modeSnapshot: 'ON_SITE', quantity: 1, status: 'PENDING', notPerformedReason: null }],
      assignments: [], history: [],
    }; };
    await page.setRequestInterception(true);
    page.on('request', async (request) => {
      const url = new URL(request.url());
      if (!url.pathname.startsWith('/api/v1/')) return request.continue();
      const path = url.pathname.replace('/api/v1', '');
      const respond = (value, status = 200) => request.respond({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': base, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'authorization,content-type,x-facility-id', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }, body: status === 204 ? '' : JSON.stringify(value) });
      if (request.method() === 'OPTIONS') return respond(null, 204);
      if (path === '/auth/refresh') return respond({ accessToken: 'fixture-token', expiresIn: 900 });
      if (path === '/me') return respond({ user: { id: 'u1', name: 'Admin Uji', email: 'admin@example.test' }, memberships: [{ id: 'm1', scopeType: 'FACILITY', role: { code: 'CLINIC_OWNER_ADMIN', name: 'Admin' }, facility: { id: 'f1', displayName: 'Klinik Uji', verificationStatus: 'VERIFIED', operatingStatus: 'ACTIVE' } }], platform: null, facility: { facilityId: 'f1', role: 'CLINIC_OWNER_ADMIN', permissions: ['order:read', ...(writable ? ['order:approve'] : []), ...(progress ? ['order:progress'] : [])] } });
      if (path === '/clinic/orders/o1') return respond(order);
      if (path === '/clinic/orders') {
        filterStatus = url.searchParams.get('status');
        return respond({ items: [{ ...order, status: filterStatus || order.status, patientName: order.patient.name, itemCount: 1, itemNames: ['Layanan Uji'] }], page: 1, limit: 20, total: 1, counts: { CANCELLED: 1, EXPIRED: 1, NO_SHOW: 1 } });
      }
      if (path === '/clinic/orders/o1/assignable-practitioners') return respond([]);
      if (path === '/clinic/orders/o1/reschedule-slots') {
        if (slotFailure) return respond({ code: 'DATABASE_UNAVAILABLE', message: 'Slot sementara tidak tersedia.' }, 503);
        return respond({ timezone: 'Asia/Jakarta', durationMinutes: 30, slots: emptySlots ? [] : [{ startsAt: `${url.searchParams.get('date')}T02:00:00.000Z`, endsAt: `${url.searchParams.get('date')}T02:30:00.000Z`, remaining: 1 }] });
      }
      if (path === '/clinic/orders/o1/reschedule') {
        writes++;
        if (moveConflict) return respond({ code: 'SLOT_FULL', message: 'Slot baru sudah penuh.' }, 409);
        const body = JSON.parse(request.postData());
        check(`${width}: reschedule sends UTC slot, version, reason and clinic header`, body.scheduledAt.endsWith('T02:00:00.000Z') && body.version === order.version && body.reason === 'Pasien meminta jadwal baru' && request.headers()['x-facility-id'] === 'f1');
        order = { ...order, version: order.version + 1, scheduledAt: body.scheduledAt, history: [{ id: 'move1', previousStatus: 'CONFIRMED', newStatus: 'CONFIRMED', reason: `Jadwal diubah. Alasan: ${body.reason}`, createdAt: new Date().toISOString(), actor: { id: 'u1', name: 'Admin Uji' } }] };
        return respond(order);
      }
      if (path === '/clinic/orders/o1/no-show') {
        writes++;
        if (tooEarly) return respond({ code: 'NO_SHOW_TOO_EARLY', message: 'Durasi kunjungan belum berakhir.' }, 409);
        const body = JSON.parse(request.postData());
        check(`${width}: no-show reason and clinic header sent`, body.reason === 'Pasien tidak datang sesuai jadwal' && request.headers()['x-facility-id'] === 'f1');
        order = { ...order, status: 'NO_SHOW', assignmentStatus: 'UNASSIGNED', assignments: [], items: order.items.map((item) => ({ ...item, status: 'NOT_PERFORMED', notPerformedReason: body.reason })), history: [{ id: 'ns1', previousStatus: 'CONFIRMED', newStatus: 'NO_SHOW', reason: body.reason, createdAt: new Date().toISOString(), actor: { id: 'u1', name: 'Admin Uji' } }] };
        return respond(order);
      }
      if (path === '/clinic/orders/o1/approve') {
        order = { ...order, status: 'EXPIRED', history: [{ id: 'expired', previousStatus: 'PENDING_APPROVAL', newStatus: 'EXPIRED', reason: 'Batas waktu persetujuan order telah berakhir.', createdAt: new Date().toISOString(), actor: null }] };
        return respond({ code: 'ORDER_APPROVAL_EXPIRED', message: 'Batas persetujuan telah lewat.' }, 409);
      }
      if (path === '/clinic/orders/o1/cancel') {
        writes++;
        if (conflict) return respond({ code: 'ORDER_STATE_CHANGED', message: 'Order berubah, muat ulang.' }, 409);
        const body = JSON.parse(request.postData());
        check(`${width}: trimmed cancellation reason and facility header`, body.reason === 'Permintaan pembatalan pasien' && request.headers()['x-facility-id'] === 'f1');
        order = { ...order, status: 'CANCELLED', assignmentStatus: 'UNASSIGNED', assignments: [], history: [{ id: 'h1', previousStatus: order.status, newStatus: 'CANCELLED', reason: body.reason, createdAt: new Date().toISOString(), actor: { id: 'u1', name: 'Admin Uji' } }] };
        return respond(order);
      }
      return respond({ code: 'TEST_ROUTE_MISSING', message: path }, 404);
    });
    const has = (text) => page.waitForFunction((value) => document.body.innerText.includes(value), { timeout: 10000 }, text);
    const click = async (text, selector = 'button') => {
      const button = await page.waitForFunction((label, sel) => [...document.querySelectorAll(sel)].find((element) => element.offsetParent !== null && element.textContent.trim() === label), { timeout: 10000 }, text, selector);
      await button.asElement().click();
    };
    const overflow = async (label) => check(`${width}/${label}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    const navigate = async () => { await page.goto(`${base}/clinic/orders/o1`, { waitUntil: 'networkidle0' }); await has('Layanan Uji'); };
    for (const state of ['PENDING_APPROVAL', 'CONFIRMED']) {
      reset(state); conflict = false;
      await navigate();
      await click('Batalkan order'); await has('Alasan pembatalan');
      check(`${width}/${state}: minimum reason enforced`, await page.$eval('[role="dialog"]', (dialog) => [...dialog.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Batalkan order')?.disabled));
      check(`${width}/${state}: max reason length`, await page.$eval('textarea', (input) => input.maxLength === 1000));
      await overflow('dialog');
      await page.type('textarea', '  Permintaan pembatalan pasien  ');
      await click('Batalkan order', '[role="dialog"] button'); await has('Order dibatalkan.');
      check(`${width}/${state}: reason retained in timeline`, await page.evaluate(() => document.body.innerText.includes('Permintaan pembatalan pasien')));
      check(`${width}/${state}: terminal actions removed`, !(await page.evaluate(() => [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Batalkan order' && button.offsetParent !== null))));
      await overflow('cancelled detail');
    }
    reset('CONFIRMED'); conflict = true; await navigate(); await click('Batalkan order'); await page.type('textarea', 'Permintaan pembatalan pasien');
    const before = writes; await click('Batalkan order', '[role="dialog"] button'); await has('Order berubah, muat ulang.');
    check(`${width}: conflict keeps detail unchanged and sends once`, order.status === 'CONFIRMED' && writes === before + 1);
    await click('Batal', '[role="dialog"] button');
    writable = false; await navigate();
    check(`${width}: read-only user has no cancellation action`, !(await page.evaluate(() => [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Batalkan order' && button.offsetParent !== null))));
    writable = true;
    for (const status of ['IN_PROGRESS', 'COMPLETED', 'REJECTED', 'EXPIRED', 'NO_SHOW']) {
      reset(status); await navigate();
      check(`${width}/${status}: cancellation hidden`, !(await page.evaluate(() => [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Batalkan order' && button.offsetParent !== null))));
    }
    check(`${width}: no browser runtime errors`, errors.length === 0);
    reset('CANCELLED');
    await page.goto(`${base}/clinic/orders`, { waitUntil: 'networkidle0' }); await has('NK-TEST-CANCEL');
    await page.select('select[aria-label="Status order"]', 'CANCELLED');
    await page.waitForFunction(() => document.querySelector('select[aria-label="Status order"]').value === 'CANCELLED');
    await page.waitForNetworkIdle();
    check(`${width}: cancelled list filter reaches API`, filterStatus === 'CANCELLED');
    check(`${width}: cancellation badge translated`, await page.evaluate(() => document.body.innerText.includes('Dibatalkan')));
    await overflow('cancelled list');
    await page.select('select[aria-label="Status order"]', 'EXPIRED'); await page.waitForNetworkIdle();
    check(`${width}: expired list filter reaches API`, filterStatus === 'EXPIRED');
    check(`${width}: expired badge translated`, await page.evaluate(() => document.body.innerText.includes('Kedaluwarsa')));
    reset('EXPIRED'); await navigate(); await has('Batas waktu persetujuan telah berakhir.');
    check(`${width}: expired detail explains terminal state`, await page.evaluate(() => document.body.innerText.includes('Order tidak bisa disetujui atau dibuka kembali.')));
    await overflow('expired detail');
    reset('PENDING_APPROVAL'); await navigate(); await click('Setujui'); await click('Setujui order', '[role="dialog"] button');
    await has('Batas waktu persetujuan telah berakhir.');
    check(`${width}: late approval closes dialog and refreshes expired state`, await page.evaluate(() => !document.querySelector('[role="dialog"]') && ![...document.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Setujui')));
    writable = false; progress = false; reset('CONFIRMED'); await navigate();
    check(`${width}: no-show hidden without progress permission`, !(await page.evaluate(() => [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Tandai tidak hadir'))));
    progress = true; await navigate(); await click('Tandai tidak hadir');
    check(`${width}: no-show reason required`, await page.$eval('[role="dialog"]', (dialog) => [...dialog.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Tandai tidak hadir')?.disabled));
    check(`${width}: no-show reason max length`, await page.$eval('textarea', (input) => input.maxLength === 1000));
    await overflow('no-show dialog');
    tooEarly = true; await page.type('textarea', 'Pasien tidak datang sesuai jadwal');
    const noShowBefore = writes; await click('Tandai tidak hadir', '[role="dialog"] button'); await has('Durasi kunjungan belum berakhir.');
    check(`${width}: early no-show sends once and retains confirmed state`, writes === noShowBefore + 1 && order.status === 'CONFIRMED');
    tooEarly = false; await click('Tandai tidak hadir', '[role="dialog"] button'); await has('Pasien ditandai tidak hadir.');
    check(`${width}: no-show preserves money and shows not-performed reason`, order.grandTotal === '50000' && order.paymentStatus === 'NOT_CONFIGURED' && await page.evaluate(() => document.body.innerText.includes('Tidak dilakukan: Pasien tidak datang sesuai jadwal')));
    check(`${width}: terminal no-show removes actions`, !(await page.evaluate(() => [...document.querySelectorAll('button')].some((button) => ['Tandai tidak hadir', 'Mulai kunjungan', 'Selesaikan order'].includes(button.textContent.trim()) && button.offsetParent !== null))));
    await overflow('no-show detail');
    for (const status of ['PENDING_APPROVAL', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED']) {
      reset(status); await navigate();
      check(`${width}/${status}: no-show hidden`, !(await page.evaluate(() => [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Tandai tidak hadir'))));
    }
    reset('CONFIRMED'); order.items[0].status = 'COMPLETED'; await navigate();
    check(`${width}: no-show hidden for progressed service`, !(await page.evaluate(() => [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Tandai tidak hadir'))));
    reset('NO_SHOW'); await page.goto(`${base}/clinic/orders`, { waitUntil: 'networkidle0' }); await has('NK-TEST-CANCEL');
    await page.select('select[aria-label="Status order"]', 'NO_SHOW'); await page.waitForNetworkIdle();
    check(`${width}: no-show filter reaches API`, filterStatus === 'NO_SHOW');
    check(`${width}: no-show badge translated`, await page.evaluate(() => document.body.innerText.includes('Tidak hadir')));
    check(`${width}: no-show produces no browser errors`, errors.length === 0);
    reset('PENDING_APPROVAL'); order.scheduledAt = '2026-11-01T01:00:00Z';
    await page.goto(`${base}/clinic/orders`, { waitUntil: 'networkidle0' }); await has('NK-TEST-CANCEL');
    check(`${width}: pending inbox shows waiting age and a passed schedule`, await page.evaluate(() => /Menunggu \d+ (menit|jam|hari)/.test(document.body.innerText) && document.body.innerText.includes('Jadwal sudah lewat')));
    await overflow('pending inbox');
    reset('CONFIRMED'); writable = false; progress = true; await navigate();
    check(`${width}: reschedule hidden without approve permission`, !(await page.evaluate(() => [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Ubah jadwal'))));
    writable = true; await navigate(); slotFailure = true; await click('Ubah jadwal'); await has('Slot sementara tidak tersedia.');
    slotFailure = false; emptySlots = true; await click('Muat ulang slot'); await has('Tidak ada slot yang cukup');
    check(`${width}: empty slots disable reschedule`, await page.$eval('[role="dialog"]', (dialog) => [...dialog.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Simpan jadwal')?.disabled));
    await click('Batal', '[role="dialog"] button'); emptySlots = false; await click('Ubah jadwal');
    await page.waitForFunction(() => document.querySelector('[role="dialog"] select')?.options.length === 2);
    check(`${width}: reschedule reason max length`, await page.$eval('[role="dialog"] textarea', (input) => input.maxLength === 1000));
    await overflow('reschedule dialog');
    await page.select('[role="dialog"] select', '2026-12-01T02:00:00.000Z');
    check(`${width}: reason still required with a slot selected`, await page.$eval('[role="dialog"]', (dialog) => [...dialog.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Simpan jadwal')?.disabled));
    await page.type('[role="dialog"] textarea', '  Pasien meminta jadwal baru  ');
    moveConflict = true; const moveBefore = writes; await click('Simpan jadwal'); await has('Slot baru sudah penuh.');
    check(`${width}: failed reschedule preserves date/version and does not auto-retry write`, writes === moveBefore + 1 && order.version === 0 && order.scheduledAt === '2026-12-01T01:00:00Z');
    moveConflict = false; await page.waitForNetworkIdle(); await click('Simpan jadwal'); await has('Jadwal diubah');
    check(`${width}: successful move preserves payment/items and updates header/history`, order.version === 1 && order.grandTotal === '50000' && order.paymentStatus === 'NOT_CONFIGURED' && order.items[0].status === 'PENDING' && await page.evaluate(() => !document.querySelector('[role="dialog"]') && document.body.innerText.includes('Pasien meminta jadwal baru')));
    await overflow('rescheduled detail');
    for (const status of ['PENDING_APPROVAL', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'NO_SHOW']) {
      reset(status); await navigate();
      check(`${width}/${status}: reschedule hidden`, !(await page.evaluate(() => [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Ubah jadwal'))));
    }
    reset('CONFIRMED'); order.timezone = 'Asia/Makassar'; order.scheduledAt = '2026-12-01T16:30:00Z'; await navigate(); await click('Ubah jadwal');
    check(`${width}: reschedule defaults to clinic local date across UTC midnight`, await page.$eval('[role="dialog"] input[type="date"]', (input) => input.value === '2026-12-02'));
    check(`${width}: clinic timezone is explicit`, await page.evaluate(() => document.body.innerText.includes('Asia/Makassar')));
    await click('Batal', '[role="dialog"] button');
    check(`${width}: reschedule has no browser errors`, errors.length === 0);
    await page.close();
  }
  console.log(`RESULT ${checks} isolated browser checks passed.`);
} finally { await browser.close(); }
