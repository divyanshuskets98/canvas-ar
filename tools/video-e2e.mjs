// AI-video path: admin with (fake) ComfyUI enabled → phone receives a generated clip and plays it on the canvas.
// Needs serve.mjs :8080, fake-supabase.mjs :9000, fake-comfyui.mjs :8188.   node tools/video-e2e.mjs outPrefix
import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)('playwright');
const out = process.argv[2] || 'video';
const Q = '?backend=http://localhost:9000&anon=test-anon&ml=0';
const t0 = Date.now(); const log = (s) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(6) + 's', s);
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const workflow = JSON.stringify({ 1: { class_type: 'LoadImage', inputs: { image: '{{IMAGE}}' } }, 2: { class_type: 'CLIPTextEncode', inputs: { text: '{{PROMPT}}' } }, 9: { class_type: 'VHS_VideoCombine', inputs: { frame_rate: 16, seed: '{{SEED}}' } } });
const actx = await b.newContext({ viewport: { width: 1200, height: 800 } });
await actx.addInitScript((wf) => localStorage.setItem('canvasAR.comfy', JSON.stringify({ enabled: true, url: 'http://127.0.0.1:8188', workflow: wf })), workflow);
const ap = await actx.newPage(); ap.on('console', (m) => { if (m.text().startsWith('[worker]')) log('admin ' + m.text()); }); ap.on('pageerror', (e) => log('ADMIN ERR ' + e.message));
await ap.goto('http://localhost:8080/admin.html' + Q);
await ap.fill('#email', 'a@b.c'); await ap.fill('#password', 'x'); await ap.click('#loginForm button');
const p = await (await b.newContext({ viewport: { width: 900, height: 640 } })).newPage(); p.on('pageerror', (e) => log('PHONE ERR ' + e.message));
await p.goto('http://localhost:8080/index.html' + Q);
await p.click('#demos .card:nth-child(3) [data-a=add]'); // Seaside
await p.waitForSelector('#procActions:not([hidden])', { timeout: 120000 });
await p.click('#btnProcPreview'); log('phone previewing, waiting for AI video…');
await p.waitForFunction(() => canvasAR.experiences.get(0)?.video, null, { timeout: 300000, polling: 1000 });
await p.waitForTimeout(4000);
const st = await p.evaluate(() => { const e = canvasAR.experiences.get(0); return { mode: canvasAR.records[0].ai.manifest.mode, prompt: canvasAR.records[0].ai.manifest.prompt, videoTime: e.video.currentTime, paused: e.video.paused, w: e.video.videoWidth, chip: document.querySelector('.chip.ai')?.textContent }; });
log(JSON.stringify(st));
await ap.close(); await p.screenshot({ path: out + '_phone.png', timeout: 90000 });
log(st.w > 0 && !st.paused ? 'PASS' : 'FAIL'); await b.close();
