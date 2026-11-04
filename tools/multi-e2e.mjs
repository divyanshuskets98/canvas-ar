// Two registered canvases; the camera shows the second one → must lock onto target index 1.
import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)('playwright');
const [y4m, out] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${y4m}`] });
const ctx = await b.newContext({ viewport: { width: 640, height: 480 }, permissions: ['camera'] });
const p = await ctx.newPage();
const logs = []; p.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
const t0 = Date.now(); const log = (s) => console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', s);
await p.goto('http://localhost:8080/index.html?ml=0');
for (const i of [3, 1]) { // ocean, then diwali
  await p.click(`#demos .card:nth-child(${i}) [data-a=add]`);
  await p.waitForSelector('#procActions:not([hidden])', { timeout: 300000 });
  await p.click('#process [data-back], #btnProcPreview').catch(() => {});
  await p.evaluate(() => { document.querySelector('#stage [data-back]').click(); });
  await p.waitForSelector('#home.active');
  log('added demo ' + i);
}
log('library: ' + await p.textContent('#library'));
await p.click('#btnStart');
try { await p.waitForSelector('#status.ok', { timeout: 180000 }); log('TRACKING: ' + await p.textContent('#status') + ' idx=' + await p.evaluate(() => canvasAR.activeIdx)); }
catch (e) { log('no lock: ' + await p.textContent('#status')); }
await p.waitForTimeout(2000); await p.screenshot({ path: out + '_multi.png' });
console.log(logs.join('\n'));
await b.close();
