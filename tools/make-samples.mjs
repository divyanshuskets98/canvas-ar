// Generates demo canvases (procedural paintings) used for testing and as printable AR targets.
// Run: node tools/make-samples.mjs <outdir>
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');
import fs from 'fs';
import path from 'path';

const out = process.argv[2] || 'samples';
fs.mkdirSync(out, { recursive: true });

const painter = String.raw`
function rng(seed){ return ()=> (seed = (seed*16807)%2147483647, (seed-1)/2147483646); }
function grad(ctx,x0,y0,x1,y1,stops){ const g=ctx.createLinearGradient(x0,y0,x1,y1); stops.forEach(([o,c])=>g.addColorStop(o,c)); return g; }
function glow(ctx,x,y,r,c){ const g=ctx.createRadialGradient(x,y,0,x,y,r); g.addColorStop(0,c); g.addColorStop(1,'rgba(0,0,0,0)'); ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y,r,0,7); ctx.fill(); }
function texture(ctx,W,H,r,amt){ for(let i=0;i<W*H/60;i++){ ctx.fillStyle='rgba('+(r()>.5?'255,255,255':'0,0,0')+','+(r()*amt)+')'; ctx.fillRect(r()*W,r()*H,1+r()*2,1+r()*2);} }

const P = {
diwali(ctx,W,H){ const r=rng(7);
  ctx.fillStyle=grad(ctx,0,0,0,H,[[0,'#1a0b2e'],[.55,'#3a1340'],[1,'#5a2410']]); ctx.fillRect(0,0,W,H);
  // rangoli
  const cx=W/2, cy=H*.80; const cols=['#e63946','#ffb703','#2a9d8f','#8338ec','#fb5607'];
  for(let k=5;k>0;k--){ ctx.fillStyle=cols[k%5]; for(let i=0;i<12;i++){ const a=i/12*6.283; ctx.beginPath(); ctx.ellipse(cx+Math.cos(a)*k*22,cy+Math.sin(a)*k*7,k*9,k*4,a,0,7); ctx.fill(); } }
  // string lights (3 arcs)
  for(let s=0;s<3;s++){ const y0=60+s*70; ctx.strokeStyle='#222'; ctx.lineWidth=2; ctx.beginPath();
    for(let i=0;i<=40;i++){ const x=i/40*W, y=y0+Math.sin(i/40*Math.PI)*60; i?ctx.lineTo(x,y):ctx.moveTo(x,y);} ctx.stroke();
    for(let i=1;i<40;i+=2){ const x=i/40*W, y=y0+Math.sin(i/40*Math.PI)*60+6; const c=['#ff4d6d','#ffd166','#06d6a0','#4cc9f0','#f72585'][(i+s)%5];
      glow(ctx,x,y,16,c+'99'); ctx.fillStyle=c; ctx.beginPath(); ctx.arc(x,y,5,0,7); ctx.fill(); ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(x-1,y-1,1.6,0,7); ctx.fill(); } }
  // diyas
  const n=7; for(let i=0;i<n;i++){ const x=W*(.12+.76*i/(n-1)), y=H*.62+((i%2)?18:0);
    glow(ctx,x,y-38,110,'rgba(255,170,40,0.35)');
    ctx.fillStyle=grad(ctx,0,y-10,0,y+30,[[0,'#d2691e'],[1,'#7a3109']]); ctx.beginPath(); ctx.ellipse(x,y,48,14,0,0,Math.PI); ctx.lineTo(x-48,y); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x-48,y); ctx.quadraticCurveTo(x,y+48,x+48,y); ctx.closePath(); ctx.fill();
    ctx.fillStyle='#f4a261'; ctx.beginPath(); ctx.ellipse(x,y,48,10,0,0,7); ctx.fill(); ctx.fillStyle='#5c2a05'; ctx.beginPath(); ctx.ellipse(x,y,36,6,0,0,7); ctx.fill();
    for(let d=0;d<6;d++){ ctx.fillStyle=['#ffd166','#e63946','#2a9d8f'][d%3]; ctx.beginPath(); ctx.arc(x-35+d*14,y+16,3,0,7); ctx.fill(); }
    // flame
    glow(ctx,x,y-30,40,'rgba(255,220,120,0.9)');
    ctx.fillStyle=grad(ctx,0,y-62,0,y-4,[[0,'#fff3b0'],[.5,'#ffb703'],[1,'#fb5607']]); ctx.beginPath(); ctx.moveTo(x,y-66); ctx.bezierCurveTo(x+16,y-36,x+12,y-8,x,y-6); ctx.bezierCurveTo(x-12,y-8,x-16,y-36,x,y-66); ctx.fill();
    ctx.fillStyle='#fffbe6'; ctx.beginPath(); ctx.ellipse(x,y-20,4,10,0,0,7); ctx.fill(); }
  texture(ctx,W,H,r,.08);
},
rain(ctx,W,H){ const r=rng(3);
  ctx.fillStyle=grad(ctx,0,0,0,H*.6,[[0,'#59636e'],[1,'#9aa5ad']]); ctx.fillRect(0,0,W,H);
  for(let i=0;i<26;i++){ ctx.fillStyle='rgba('+(70+r()*40|0)+','+(78+r()*40|0)+','+(88+r()*40|0)+',0.55)'; ctx.beginPath(); ctx.ellipse(r()*W,r()*H*.28,80+r()*160,30+r()*40,0,0,7); ctx.fill(); }
  // buildings silhouettes
  for(let i=0;i<14;i++){ const w=50+r()*90,h=120+r()*200,x=i*W/14-10; ctx.fillStyle='rgb('+(60+r()*20|0)+','+(66+r()*20|0)+','+(74+r()*20|0)+')'; ctx.fillRect(x,H*.62-h,w,h); }
  // trees
  for(let i=0;i<9;i++){ const x=r()*W; ctx.fillStyle='#3d4a3f'; ctx.beginPath(); ctx.arc(x,H*.6,40+r()*30,0,7); ctx.fill(); }
  // ground & puddle lake
  ctx.fillStyle=grad(ctx,0,H*.6,0,H,[[0,'#56606a'],[1,'#3a4249']]); ctx.fillRect(0,H*.6,W,H*.4);
  ctx.fillStyle=grad(ctx,0,H*.68,0,H,[[0,'#7d8f9c'],[1,'#4c6070']]); ctx.beginPath(); ctx.ellipse(W*.5,H*.84,W*.42,H*.13,0,0,7); ctx.fill();
  ctx.strokeStyle='rgba(220,230,240,0.35)'; for(let i=0;i<30;i++){ const x=W*.5+(r()-.5)*W*.7,y=H*.78+r()*H*.14; ctx.beginPath(); ctx.ellipse(x,y,6+r()*20,2+r()*5,0,0,7); ctx.stroke(); }
  // person with umbrella
  const ux=W*.2, uy=H*.6; ctx.fillStyle='#b5172f'; ctx.beginPath(); ctx.arc(ux,uy-70,46,Math.PI,0); ctx.fill(); ctx.fillStyle='#222'; ctx.fillRect(ux-2,uy-70,4,60); ctx.fillRect(ux-12,uy-40,24,50);
  // rain streaks
  ctx.strokeStyle='rgba(230,235,240,0.35)'; ctx.lineWidth=1.2; for(let i=0;i<700;i++){ const x=r()*W,y=r()*H; ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x-6,y+26); ctx.stroke(); }
  texture(ctx,W,H,r,.06);
},
ocean(ctx,W,H){ const r=rng(11);
  ctx.fillStyle=grad(ctx,0,0,0,H*.45,[[0,'#3d8fd6'],[1,'#a9d6f5']]); ctx.fillRect(0,0,W,H*.45);
  for(let i=0;i<7;i++){ const x=r()*W,y=40+r()*H*.25; for(let k=0;k<6;k++){ ctx.fillStyle='rgba(255,255,255,0.8)'; ctx.beginPath(); ctx.arc(x+k*28-70+r()*10,y+r()*12,24+r()*16,0,7); ctx.fill(); } }
  glow(ctx,W*.82,H*.14,90,'rgba(255,250,200,0.9)'); ctx.fillStyle='#fffbe0'; ctx.beginPath(); ctx.arc(W*.82,H*.14,32,0,7); ctx.fill();
  ctx.fillStyle=grad(ctx,0,H*.45,0,H*.82,[[0,'#1b6ca8'],[1,'#0a3d62']]); ctx.fillRect(0,H*.45,W,H*.37);
  for(let i=0;i<260;i++){ const y=H*.46+Math.pow(r(),1.4)*H*.36, x=r()*W, l=10+ (y-H*.45)/H*120; ctx.strokeStyle='rgba(255,255,255,'+(0.15+r()*.35)+')'; ctx.lineWidth=1+(y-H*.45)/H*4; ctx.beginPath(); ctx.moveTo(x,y); ctx.quadraticCurveTo(x+l/2,y-3,x+l,y); ctx.stroke(); }
  // sand
  ctx.fillStyle=grad(ctx,0,H*.8,0,H,[[0,'#e9d8a6'],[1,'#d4b483']]); ctx.beginPath(); ctx.moveTo(0,H*.84); for(let x=0;x<=W;x+=20) ctx.lineTo(x,H*.82+Math.sin(x/90)*10); ctx.lineTo(W,H); ctx.lineTo(0,H); ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,0.9)'; ctx.lineWidth=5; ctx.beginPath(); for(let x=0;x<=W;x+=20) ctx.lineTo(x,H*.82+Math.sin(x/90)*10-3); ctx.stroke();
  // boat
  const bx=W*.35, by=H*.6; ctx.fillStyle='#6b2d0c'; ctx.beginPath(); ctx.moveTo(bx-70,by); ctx.lineTo(bx+70,by); ctx.lineTo(bx+50,by+24); ctx.lineTo(bx-50,by+24); ctx.fill(); ctx.fillStyle='#fff'; ctx.beginPath(); ctx.moveTo(bx,by-110); ctx.lineTo(bx,by-4); ctx.lineTo(bx+60,by-8); ctx.fill(); ctx.fillStyle='#e63946'; ctx.beginPath(); ctx.moveTo(bx-4,by-100); ctx.lineTo(bx-4,by-6); ctx.lineTo(bx-50,by-8); ctx.fill();
  // gulls
  ctx.strokeStyle='#223'; ctx.lineWidth=3; for(let i=0;i<4;i++){ const x=W*.45+i*50,y=H*.18+i*14; ctx.beginPath(); ctx.moveTo(x-14,y); ctx.quadraticCurveTo(x-7,y-8,x,y); ctx.quadraticCurveTo(x+7,y-8,x+14,y); ctx.stroke(); }
  texture(ctx,W,H,r,.05);
},
forest(ctx,W,H){ const r=rng(5);
  ctx.fillStyle=grad(ctx,0,0,0,H*.5,[[0,'#7ec8e3'],[1,'#e0f4ff']]); ctx.fillRect(0,0,W,H);
  for(let i=0;i<4;i++){ const x=r()*W,y=30+r()*H*.18; for(let k=0;k<5;k++){ ctx.fillStyle='rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.arc(x+k*26-50,y+r()*10,20+r()*14,0,7); ctx.fill(); } }
  ctx.fillStyle='#7fa37a'; ctx.beginPath(); ctx.moveTo(0,H*.5); for(let x=0;x<=W;x+=10) ctx.lineTo(x,H*.38+Math.sin(x/140)*40+Math.sin(x/53)*10); ctx.lineTo(W,H); ctx.lineTo(0,H); ctx.fill();
  ctx.fillStyle='#4f8a3c'; ctx.beginPath(); ctx.moveTo(0,H*.6); for(let x=0;x<=W;x+=10) ctx.lineTo(x,H*.5+Math.sin(x/100+2)*30); ctx.lineTo(W,H); ctx.lineTo(0,H); ctx.fill();
  // lake
  ctx.fillStyle=grad(ctx,0,H*.66,0,H*.86,[[0,'#5aa9c9'],[1,'#2f7697']]); ctx.beginPath(); ctx.ellipse(W*.55,H*.76,W*.3,H*.08,0,0,7); ctx.fill();
  // trees
  for(let i=0;i<22;i++){ const x=r()*W, y=H*(.55+r()*.4), s=30+r()*50; if(Math.abs(x-W*.55)<W*.3 && Math.abs(y-H*.76)<H*.09) continue;
    ctx.fillStyle='#5b3a1e'; ctx.fillRect(x-4,y-s*.2,8,s*.6);
    for(let k=0;k<3;k++){ ctx.fillStyle=['#2d6a4f','#40916c','#1b4332'][k]; ctx.beginPath(); ctx.moveTo(x,y-s*1.6+k*s*.35); ctx.lineTo(x+s*.55,y-s*.3+k*s*.12); ctx.lineTo(x-s*.55,y-s*.3+k*s*.12); ctx.fill(); } }
  // flowers / grass
  for(let i=0;i<400;i++){ const x=r()*W,y=H*.88+r()*H*.12; ctx.strokeStyle='rgba(30,90,30,0.8)'; ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+(r()-.5)*6,y-8-r()*12); ctx.stroke(); }
  for(let i=0;i<60;i++){ ctx.fillStyle=['#ffd60a','#ff006e','#ffffff'][i%3]; ctx.beginPath(); ctx.arc(r()*W,H*.9+r()*H*.1,3,0,7); ctx.fill(); }
  texture(ctx,W,H,r,.06);
},
citynight(ctx,W,H){ const r=rng(9);
  ctx.fillStyle=grad(ctx,0,0,0,H,[[0,'#050a1f'],[.6,'#16214a'],[1,'#0b0f22']]); ctx.fillRect(0,0,W,H);
  for(let i=0;i<160;i++){ const x=r()*W,y=r()*H*.45,s=r()*1.8+.4; ctx.fillStyle='rgba(255,255,255,'+(.4+r()*.6)+')'; ctx.beginPath(); ctx.arc(x,y,s,0,7); ctx.fill(); }
  glow(ctx,W*.18,H*.15,80,'rgba(230,235,255,0.5)'); ctx.fillStyle='#f1f3ff'; ctx.beginPath(); ctx.arc(W*.18,H*.15,30,0,7); ctx.fill();
  for(let layer=0;layer<2;layer++){ let x=-20; while(x<W){ const w=50+r()*90,h=(layer?140:220)+r()*(layer?160:200); const y=H*.82-h;
      ctx.fillStyle=layer?'#141a33':'#1d2547'; ctx.fillRect(x,y,w,h);
      for(let wy=y+12;wy<H*.8;wy+=18) for(let wx=x+8;wx<x+w-10;wx+=14){ if(r()<(layer?.35:.45)){ ctx.fillStyle=['#ffd27f','#ffe9b0','#9ad1ff'][r()*3|0]; ctx.fillRect(wx,wy,7,9);} }
      x+=w+4; } }
  // road with cars
  ctx.fillStyle='#0a0c14'; ctx.fillRect(0,H*.82,W,H*.18); ctx.fillStyle='#ffd166'; for(let x=0;x<W;x+=60) ctx.fillRect(x,H*.9,30,4);
  for(let i=0;i<5;i++){ const x=r()*W; ctx.fillStyle='#c1121f'; ctx.fillRect(x,H*.86,48,16); glow(ctx,x+46,H*.87,14,'rgba(255,240,180,.9)'); glow(ctx,x+2,H*.87,10,'rgba(255,40,40,.9)'); }
  for(let i=0;i<8;i++){ const x=i*W/8+40; ctx.fillStyle='#333'; ctx.fillRect(x,H*.72,4,H*.1); glow(ctx,x+2,H*.72,26,'rgba(255,200,120,.8)'); }
  texture(ctx,W,H,r,.05);
}};
window.paint=(name,W,H)=>{ const c=document.createElement('canvas'); c.width=W; c.height=H; P[name](c.getContext('2d'),W,H); return c.toDataURL('image/jpeg',0.92); };
`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');
await page.addScriptTag({ content: painter });
const list = [['diwali', 1200, 800], ['rain', 1200, 800], ['ocean', 1200, 800], ['forest', 1200, 800], ['citynight', 900, 1200]];
for (const [n, w, h] of list) {
  const url = await page.evaluate(([n, w, h]) => window.paint(n, w, h), [n, w, h]);
  fs.writeFileSync(path.join(out, n + '.jpg'), Buffer.from(url.split(',')[1], 'base64'));
  console.log('wrote', n);
}
await browser.close();
