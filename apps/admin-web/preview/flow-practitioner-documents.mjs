/** Isolated browser regression. Intercepts API/storage requests; never contacts a real database/MinIO.
 * Run against a built/running admin-web: node preview/flow-practitioner-documents.mjs (WEB_URL/CHROME optional).
 */
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const base = process.env.WEB_URL ?? 'http://localhost:3000';
let checks = 0;
const check = (name, ok) => { assert.ok(ok, name); checks++; console.log(`PASS ${name}`); };
try {
  for (const width of [1440, 390]) for (const area of ['admin', 'clinic']) {
    const label = `${width}/${area}`;
    const page = await browser.newPage();
    await page.setViewport({ width, height: 900 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let readonly = false;
    let locked = false;
    let rejectPut = false;
    let inits = 0;
    let puts = 0;
    let completes = 0;
    let links = 0;
    let scan = null;
    const credential = { id: 'c1', credentialType: 'STR', numberMasked: '****1234', issuingAuthority: 'KKI', validFrom: null, validUntil: null, reviewStatus: 'UPLOADED', createdAt: new Date().toISOString() };
    const practitioner = { id: 'p1', fullName: 'Nakes Uji', practitionerType: { id: 'type1', code: 'DOKTER', name: 'Dokter' }, phone: null, email: null, verificationStatus: 'SUBMITTED', operatingStatus: 'INACTIVE', registeredVia: 'CLINIC', createdAt: new Date().toISOString(), registeredByFacility: { id: 'f1', displayName: 'Klinik Uji' }, credentials: [credential], affiliations: [], history: [], missing: {}, canSubmit: false };
    const affiliation = { id: 'a1', status: 'PROPOSED', startDate: null, endDate: null, createdAt: new Date().toISOString(), facility: { id: 'f1', displayName: 'Klinik Uji' }, practitioner: { ...practitioner, canManageDocuments: true } };
    await page.setRequestInterception(true);
    page.on('request', async (request) => {
      const url = new URL(request.url());
      if (!url.pathname.startsWith('/api/v1/')) return request.continue();
      const path = url.pathname.replace('/api/v1', '');
      const respond = (data, status = 200) => request.respond({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': base, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'authorization,content-type,x-facility-id', 'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS' }, body: status === 204 ? '' : JSON.stringify(data) });
      if (request.method() === 'OPTIONS') return respond(null, 204);
      if (path === '/auth/refresh') return respond({ accessToken: 'isolated-token', expiresIn: 900 });
      if (path === '/me') return respond({ user: { id: 'u1', name: 'Reviewer Uji', email: 'reviewer@example.test' }, memberships: [{ id: 'm1', scopeType: area === 'admin' ? 'PLATFORM' : 'FACILITY', role: { code: 'CLINIC_OWNER_ADMIN', name: 'Admin' }, facility: { id: 'f1', displayName: 'Klinik Uji', verificationStatus: 'VERIFIED', operatingStatus: 'ACTIVE' } }], platform: area === 'admin' ? { roles: ['PLATFORM_SUPER_ADMIN'], permissions: readonly ? ['practitioner:read'] : ['practitioner:read', 'practitioner:review'] } : null, facility: area === 'clinic' ? { facilityId: 'f1', role: 'CLINIC_OWNER_ADMIN', permissions: readonly ? ['affiliation:read'] : ['affiliation:read', 'affiliation:manage'] } : null });
      if (path === '/admin/practitioners/p1') return respond(practitioner);
      if (path === '/clinic/practitioner-affiliations') return respond({ items: [affiliation, { ...affiliation, id: 'a2', practitioner: { ...practitioner, id: 'p2', fullName: 'Nakes Klinik Lain', canManageDocuments: false } }], total: 2, counts: { PROPOSED: 2 } });
      if (path === `/${area}/practitioners/p1/documents`) return respond({ practitionerId: 'p1', verificationStatus: locked ? 'UNDER_REVIEW' : 'SUBMITTED', editable: !locked, credentials: [{ ...credential, document: scan }] });
      if (path.endsWith('/upload-init')) {
        inits++;
        return respond({ document: { id: 'd1' }, upload: { method: 'PUT', url: `${base}/api/v1/documents/d1/upload?token=isolated`, headers: { 'Content-Type': 'application/pdf' } } }, 201);
      }
      if (path === '/documents/d1/upload') {
        puts++;
        return rejectPut ? respond({ code: 'VALIDATION_FAILED', message: 'Isi file tidak cocok dengan PDF' }, 422) : respond(null, 204);
      }
      if (path.endsWith('/complete')) {
        completes++; scan = { id: 'd1', fileName: 'scan-str.pdf', mimeType: 'application/pdf', sizeBytes: 20, status: 'UPLOADED', uploadedAt: new Date().toISOString() };
        return respond(scan);
      }
      if (path.endsWith('/d1/url')) { links++; return respond({ url: `${base}/api/v1/documents/d1/content?token=isolated` }); }
      return respond({ code: 'TEST_ROUTE_MISSING', message: path }, 404);
    });
    const has = (text) => page.waitForFunction((value) => document.body.innerText.includes(value), { timeout: 10000 }, text);
    const click = async (text) => {
      const handle = await page.waitForFunction((label) => [...document.querySelectorAll('button')].find((element) => element.offsetParent !== null && element.textContent.trim() === label), { timeout: 10000 }, text);
      await handle.asElement().click();
    };
    const choose = async (type, empty = false) => page.evaluate((mime, blank) => {
      const input = document.querySelector('input[type=file]');
      const transfer = new DataTransfer(); transfer.items.add(new File([blank ? '' : '%PDF-1.7\n test bytes'], 'scan-str.pdf', { type: mime }));
      input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    }, type, empty);
    const navigate = async () => {
      await page.goto(`${base}/${area === 'admin' ? 'admin/practitioners/p1' : 'clinic/practitioners'}`, { waitUntil: 'networkidle0' });
      if (area === 'clinic' && !readonly) await click('Scan STR / SIP');
      if (!readonly) await has('Scan STR / SIP');
    };
    await navigate(); await page.waitForSelector('input[type=file]');
    if (area === 'clinic') check(`${label}: only creator clinic has document button`, await page.evaluate(() => [...document.querySelectorAll('button')].filter((element) => element.textContent.trim() === 'Scan STR / SIP').length === 1));
    await choose('text/html'); await has('Hanya PDF, JPG, atau PNG'); check(`${label}: invalid MIME blocked before API`, inits === 0);
    await choose('application/pdf', true); await has('Ukuran file harus'); check(`${label}: empty file blocked`, inits === 0);
    rejectPut = true; await choose('application/pdf'); await has('Isi file tidak cocok'); check(`${label}: failed bytes never complete`, inits === 1 && completes === 0);
    rejectPut = false; await choose('application/pdf'); await has('Scan berhasil diunggah'); await has('scan-str.pdf');
    check(`${label}: init/PUT/complete sequence`, inits === 2 && puts === 2 && completes === 1);
    check(`${label}: practitioner remains submitted`, practitioner.verificationStatus === 'SUBMITTED');
    await page.evaluate(() => { window.__openedScan = ''; window.open = () => ({ opener: null, location: { replace: (url) => { window.__openedScan = url; } }, close() {} }); });
    await click('Lihat scan'); await page.waitForFunction(() => window.__openedScan?.includes('/documents/d1/content?token='));
    check(`${label}: fresh authorized preview URL requested`, links === 1);
    check(`${label}: no horizontal overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    locked = true; await navigate(); await has('Dokumen terkunci');
    check(`${label}: upload controls hidden during review`, await page.evaluate(() => document.querySelectorAll('input[type=file]').length === 0));
    check(`${label}: locked files remain viewable`, await page.evaluate(() => [...document.querySelectorAll('button')].some((element) => element.textContent.trim() === 'Lihat scan')));
    readonly = true; await navigate();
    check(`${label}: documents hidden without reviewer/manage permission`, await page.evaluate(() => !document.querySelector('input[type=file]') && ![...document.querySelectorAll('button')].some((element) => ['Lihat scan', 'Scan STR / SIP'].includes(element.textContent.trim()))));
    check(`${label}: no runtime errors`, errors.length === 0); await page.close();
  }
  console.log(`${checks} checks passed with isolated API fixtures; not live MinIO/database.`);
} finally { await browser.close(); }
