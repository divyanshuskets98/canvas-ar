// node tools/still.mjs <url> <outPrefix> <times,comma> [w] [h] [actions-json]
import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)('playwright');
const [url, out, times='2', w='1000', h='700', actions='[]'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: +w, height: +h } });
const logs = []; p.on('console', m => { if (m.type() !== 'debug') logs.push(m.type()+': '+m.text()); }); p.on('pageerror', e => logs.push('PAGEERROR: '+e.message));
await p.goto(url); await p.waitForFunction('window.previewReady', null, { timeout: 60000 });
let prev = 0;
for (const t of times.split(',').map(Number)) {
  for (const a of JSON.parse(actions)) if (a.at > prev && a.at <= t) { await p.evaluate(a.js); }
  await p.evaluate((d) => window.stepSim(d), t - prev); prev = t;
  await p.screenshot({ path: `${out}_${t}.png`, timeout: 60000 });
}
console.log(logs.slice(0, 30).join('\n')); await b.close();
