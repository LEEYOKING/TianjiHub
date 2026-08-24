import { chromium } from '/usr/local/lib/node_modules/playwright/index.mjs';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1700 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.error('JS ERR:', e.message));

await page.goto('http://localhost:4321/overview', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.screenshot({ path: '_shots7/overview.png', fullPage: true });
console.log('  ✓ overview.png');

const page2 = await ctx.newPage();
await page2.goto('http://localhost:4321/sector', { waitUntil: 'networkidle' });
await page2.waitForTimeout(2000);
await page2.screenshot({ path: '_shots7/sector.png', fullPage: true });
console.log('  ✓ sector.png');

const page3 = await ctx.newPage();
await page3.goto('http://localhost:4321/surgery', { waitUntil: 'networkidle' });
await page3.waitForTimeout(2000);
await page3.screenshot({ path: '_shots7/surgery.png', fullPage: true });
console.log('  ✓ surgery.png');

// 移动端 360 宽
const mobileCtx = await browser.newContext({ viewport: { width: 380, height: 1700 } });
const mp1 = await mobileCtx.newPage();
await mp1.goto('http://localhost:4321/overview', { waitUntil: 'networkidle' });
await mp1.waitForTimeout(2000);
await mp1.screenshot({ path: '_shots7/overview-mobile.png', fullPage: true });
console.log('  ✓ overview-mobile.png');

const mp2 = await mobileCtx.newPage();
await mp2.goto('http://localhost:4321/sector', { waitUntil: 'networkidle' });
await mp2.waitForTimeout(2000);
await mp2.screenshot({ path: '_shots7/sector-mobile.png', fullPage: true });
console.log('  ✓ sector-mobile.png');

await browser.close();
