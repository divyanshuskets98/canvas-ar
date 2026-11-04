// Full workflow, two users at once:
//   phone A (camera sees canvas A) and phone B (camera sees canvas B) scan simultaneously →
//   scans go to the backend → the admin dashboard auto-processes both → each phone receives
//   *its own* animation package and shows it on the tracked canvas.
// Needs: tools/serve.mjs on :8080 and tools/fake-supabase.mjs on :9000.
//   node tools/multiuser-e2e.mjs camA.y4m camB.y4m outPrefix
import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)('playwright');
const [camA, camB, out] = process.argv.slice(2);
const Q = '?backend=http://localhost:9000&anon=test-anon&ml=0';
const t0 = Date.now(); const log = (s) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(6) + 's', s);
const gl = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

async function phone(name, cam) {
  const b = await chromium.launch({ args: [...gl, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${cam}`] });
  const ctx = await b.newContext({ viewport: { width: 640, height: 480 }, permissions: ['camera'] });
  const p = await ctx.newPage(); p.on('pageerror', (e) => log(`${name} PAGEERROR ${e.message}`));
  await p.goto('http://localhost:8080/index.html' + Q);
  return { name, b, p };
}
const A = await phone('A', camA), B = await phone('B', camB);
// admin
const ab = await chromium.launch({ args: gl });
const ap = await (await ab.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
ap.on('pageerror', (e) => log('ADMIN PAGEERROR ' + e.message)); ap.on('console', (m) => { if (m.text().startsWith('[worker]')) log('admin ' + m.text()); });
await ap.goto('http://localhost:8080/admin.html' + Q);
await ap.fill('#email', 'admin@example.com'); await ap.fill('#password', 'secret'); await ap.click('#loginForm button');
await ap.waitForSelector('#dash:not([hidden])'); log('admin signed in');

// both phones scan at the same time
await Promise.all([A, B].map(async (ph) => {
  await ph.p.click('#btnScan'); await ph.p.waitForTimeout(2500); await ph.p.click('#btnCapture'); log(`${ph.name} captured`);
  await ph.p.waitForSelector('#status.ok', { timeout: 300000 }); log(`${ph.name} tracking: ${await ph.p.textContent('#status')}`);
}));
const ids = {};
for (const ph of [A, B]) ids[ph.name] = await ph.p.evaluate(() => canvasAR.records[0].id);
log('scan ids ' + JSON.stringify(ids));
// wait for AI results to come back to each phone
await Promise.all([A, B].map(async (ph) => {
  await ph.p.waitForFunction(() => canvasAR.records[0]?.ai?.status === 'done' && canvasAR.experiences.get(0)?.rec?.ai?.manifest, null, { timeout: 400000, polling: 1000 });
  const r = await ph.p.evaluate(() => { const rec = canvasAR.records[0]; const e = canvasAR.experiences.get(0); return { id: rec.id, manifestFor: rec.ai.manifest.scanId, mode: rec.ai.manifest.mode, plan: rec.ai.manifest.plan.map((x) => x.id), active: [...e.active.keys()], lib: canvasAR.library.length, chip: document.querySelector('.chip.ai')?.textContent }; });
  log(`${ph.name} received ${JSON.stringify(r)}`);
  if (r.id !== r.manifestFor) throw new Error(ph.name + ' got someone else\'s animation!');
}));
await ap.waitForTimeout(3000);
for (const ph of [A, B]) { await ph.p.waitForTimeout(1500); await ph.p.screenshot({ path: `${out}_phone${ph.name}.png` }); }
await ap.screenshot({ path: `${out}_admin.png`, fullPage: true });
log('admin cards: ' + await ap.evaluate(() => [...document.querySelectorAll('.scan')].map((c) => c.querySelector('b').textContent + ':' + c.querySelector('.badge').textContent).join(', ')));
log('PASS');
for (const x of [A.b, B.b, ab]) await x.close();
