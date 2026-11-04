// Scanner flow with synthetic camera: scan → capture → process (with ML enabled) → AR lock.
import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)('playwright');
const [y4m, out] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${y4m}`] });
const ctx = await b.newContext({ viewport: { width: 480, height: 800 }, permissions: ['camera'], isMobile: true, hasTouch: true });
const p = await ctx.newPage();
const logs = []; p.on('console', (m) => logs.push(m.type() + ': ' + m.text())); p.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
const t0 = Date.now(); const log = (s) => console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', s);
await p.goto('http://localhost:8080/index.html');
await p.screenshot({ path: out + '_home.png', fullPage: true });
await p.click('#btnStart');
await p.waitForTimeout(2500);
await p.screenshot({ path: out + '_scan.png' });
await p.click('#btnCapture');
log('captured');
await p.waitForTimeout(1500); await p.screenshot({ path: out + '_proc.png' });
try { await p.waitForSelector('#status.ok', { timeout: 300000 }); log('TRACKING: ' + await p.textContent('#status')); }
catch (e) { log('no lock: ' + await p.textContent('#status')); }
log('ml step: ' + await p.evaluate(() => document.querySelector('[data-step=ml]').textContent));
await p.waitForTimeout(3000); await p.screenshot({ path: out + '_ar.png' });
console.log(logs.slice(-15).join('\n'));
await b.close();
