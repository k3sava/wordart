import { chromium } from 'playwright';
const BASE = 'http://localhost:8011';
const URLS = ['/', '/line/', '/blur/', '/glitch/', '/type/'];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => { try { localStorage.setItem('wa.splash.seen','1'); } catch {} });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errs.push(`console.error: ${m.text()}`); });
for (const u of URLS) {
  await page.goto(BASE + u, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(600);
  const ok = await page.evaluate(() => ({
    hasTop: !!document.querySelector('.wa-top, .theme-switcher-container'),
    hasFooter: !!document.querySelector('.wa-bottom, .kami-footer'),
    hasGrid: !!document.querySelector('.home-grid'),
    hasPanel: !!document.querySelector('.wg'),
    hasCanvas: !!document.querySelector('#cv'),
    hasWAEffect: !!window.WAEffect,
    bodyClass: document.body.className,
  }));
  console.log(u, JSON.stringify(ok));
}
console.log('errors:', errs.length ? errs.join('\n') : 'none');
await browser.close();
