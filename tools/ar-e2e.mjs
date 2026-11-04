// End-to-end AR test with a synthetic camera feed (fake webcam playing a y4m of a canvas on a wall).
// node tools/ar-e2e.mjs <cam.y4m> <outPrefix>
import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)('playwright');
const [y4m, out] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${y4m}`] });
const ctx = await b.newContext({ viewport: { width: 640, height: 480 }, permissions: ['camera'] });
const p = await ctx.newPage();
const logs = []; p.on('console', (m) => logs.push(m.type() + ': ' + m.text())); p.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
const t0 = Date.now(); const log = (s) => console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', s);
await p.goto('http://localhost:8080/index.html?ml=0');
await p.click(process.argv[4] ? `#demos .card:nth-child(${process.argv[4]}) [data-a=add]` : '#demos .card:first-child [data-a=add]');
log('processing…');
await p.waitForSelector('#procActions:not([hidden])', { timeout: 300000 });
log('processed: ' + await p.textContent('#procSteps'));
await p.screenshot({ path: out + '_proc.png' });
await p.click('#btnProcAR');
log('starting AR');
try { await p.waitForSelector('#status.ok', { timeout: 180000 }); log('TRACKING: ' + await p.textContent('#status')); }
catch (e) { log('no lock: ' + await p.textContent('#status')); }
for (let i = 0; i < 3; i++) { await p.waitForTimeout(2500); await p.screenshot({ path: `${out}_ar${i}.png` }); log('shot ' + i + ' status=' + await p.textContent('#status')); }
const st = await p.evaluate(() => { const s = window.canvasAR.session; return s ? s.stages.map((x) => ({ tracked: x.tracked, presence: x.presence })) : null; });
log(JSON.stringify(st));
console.log(logs.filter((l) => !l.includes('GPU stall')).slice(-25).join('\n'));
await b.close();
