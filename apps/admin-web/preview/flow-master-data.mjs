/**
 * DEVELOPMENT PREVIEW ONLY: clicks through the master data create / duplicate / deactivate flow against the
 * preview mock API. Needs `next start` on :3000 and `PREVIEW_ROLE=platform node preview/mock-api.mjs`.
 */
import puppeteer from 'puppeteer-core';

const executablePath = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const width = Number(process.env.WIDTH ?? 1440);
const browser = await puppeteer.launch({ executablePath, headless: true });
const page = await browser.newPage();
await page.setViewport({ width, height: 900 });
const results = [];
const check = (name, ok) => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) process.exitCode = 1;
};
const clickByText = async (selector, text) => {
  const handle = await page.waitForFunction((sel, label) => [...document.querySelectorAll(sel)].find((element) => element.textContent?.trim().includes(label)), { timeout: 8000 }, selector, text);
  await handle.asElement().click();
};
const bodyHas = (text) => page.waitForFunction((label) => document.body.innerText.includes(label), { timeout: 8000 }, text).then(() => true, () => false);
const typeInto = async (label, value) => {
  const input = await page.waitForFunction((text) => {
    const labelElement = [...document.querySelectorAll('[role="dialog"] label')].find((element) => element.textContent?.replace('*', '').trim() === text);
    return labelElement && document.getElementById(labelElement.htmlFor);
  }, { timeout: 8000 }, label);
  await input.asElement().focus();
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await input.asElement().type(value);
};

try {
  await page.goto('http://localhost:3000/admin/master/facility-types', { waitUntil: 'networkidle0' });
  check('list shows seeded facility type', await bodyHas('KLINIK'));

  await clickByText('button', 'Tambah');
  await typeInto('Kode', 'klinik');
  await typeInto('Nama', 'Klinik lain');
  await clickByText('[role="dialog"] button', 'Simpan');
  check('duplicate code shows a field error', await bodyHas('code is already used'));

  await typeInto('Kode', 'klinik homecare');
  await typeInto('Nama', 'Klinik homecare');
  await clickByText('[role="dialog"] button', 'Simpan');
  check('valid create shows a success toast', await bodyHas('Klinik homecare ditambahkan'));
  check('new row appears with normalised code', await bodyHas('KLINIK_HOMECARE'));

  // Desktop renders the table, mobile the card list; click the visible one.
  const actionButton = await page.waitForFunction(() => [...document.querySelectorAll('[aria-label="Aksi untuk Klinik homecare"]')].find((element) => element.offsetParent !== null), { timeout: 8000 });
  await actionButton.asElement().click();
  await clickByText('[role="menuitem"]', 'Nonaktifkan');
  check('deactivation asks for confirmation', await bodyHas('Nonaktifkan Klinik homecare?'));
  await clickByText('[role="dialog"] button', 'Nonaktifkan');
  check('deactivation succeeds', await bodyHas('Klinik homecare dinonaktifkan'));

  await page.goto('http://localhost:3000/admin/master/facility-types?active=false', { waitUntil: 'networkidle0' });
  check('status filter is read from the URL', (await bodyHas('KLINIK_HOMECARE')) && !(await page.evaluate(() => document.body.innerText.includes('\nKLINIK\n'))));
} catch (error) {
  check(`flow crashed: ${error.message}`, false);
} finally {
  console.log(results.join('\n'));
  await browser.close();
}
