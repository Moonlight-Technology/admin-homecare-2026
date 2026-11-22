/**
 * DEVELOPMENT PREVIEW ONLY: full-page screenshots at the DESIGN.md §8 breakpoints with exact viewports.
 * Needs `next start` on :3000 and preview/mock-api.mjs on :4000 with the matching PREVIEW_ROLE.
 *
 *   node preview/screenshots.mjs <outdir> <name>=<path> [<name>=<path> ...]
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const [outDir, ...pages] = process.argv.slice(2);
const executablePath = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sizes = [[390, 844], [768, 1024], [1024, 768], [1440, 900]];

mkdirSync(outDir, { recursive: true });
const browser = await puppeteer.launch({ executablePath, headless: true });
try {
  for (const entry of pages) {
    const [name, path] = entry.split('=');
    for (const [width, height] of sizes) {
      const page = await browser.newPage();
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      await page.goto(`http://localhost:3000${path}`, { waitUntil: 'networkidle0' });
      // The page renders after the session check; wait until the loader is gone.
      await page.waitForFunction(() => !document.querySelector('[role="status"] .animate-spin'), { timeout: 15000 }).catch(() => undefined);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await page.screenshot({ path: join(outDir, `${name}-${width}x${height}.png`), fullPage: true });
      console.log(`${name} ${width}x${height}${overflow > 0 ? `  ⚠ horizontal overflow ${overflow}px` : ''}`);
      await page.close();
    }
  }
} finally {
  await browser.close();
}
