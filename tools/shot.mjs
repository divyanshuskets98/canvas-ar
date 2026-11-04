// node tools/shot.mjs <url> <out.png> [w] [h] [waitExpr] [extraWaitMs]
import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)('playwright');
const [url, out, w='1400', h='900', waitExpr='window.done', extra='0'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: +w, height: +h } });
const logs = []; p.on('console', m => logs.push(m.type()+': '+m.text())); p.on('pageerror', e => logs.push('PAGEERROR: '+e.message));
await p.goto(url); try { await p.waitForFunction(waitExpr, null, { timeout: 60000 }); } catch(e) { logs.push('WAIT TIMEOUT'); }
await p.waitForTimeout(+extra); await p.screenshot({ path: out });
const r = await p.evaluate(() => window.results ? JSON.stringify(window.results, null, 1) : ''); console.log(r); console.log(logs.join('\n')); await b.close();
