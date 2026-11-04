// Stand-in for a ComfyUI server (testing the admin's optional AI-video path).
// "Generates" a short clip from the uploaded image with ffmpeg (gentle zoom), returned like VHS_VideoCombine.
//   node tools/fake-comfyui.mjs [port=8188]
import http from 'http'; import fs from 'fs'; import os from 'os'; import path from 'path'; import { execFile } from 'child_process';
const port = +process.argv[2] || 8188;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fakecomfy-'));
const jobs = {};
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' };
const json = (res, o, code = 200) => { res.writeHead(code, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
const body = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (u.pathname === '/system_stats') return json(res, { system: { comfyui_version: 'fake-0.1' }, devices: [{ name: 'fake GPU' }] });
  if (u.pathname === '/upload/image') {
    const b = await body(req); const boundary = '--' + req.headers['content-type'].split('boundary=')[1];
    const part = b.toString('latin1').split(boundary).find((p) => p.includes('name="image"'));
    const name = /filename="([^"]+)"/.exec(part)[1]; const data = part.slice(part.indexOf('\r\n\r\n') + 4, part.lastIndexOf('\r\n'));
    fs.writeFileSync(path.join(dir, name), Buffer.from(data, 'latin1')); return json(res, { name, subfolder: '', type: 'input' });
  }
  if (u.pathname === '/prompt') {
    const g = JSON.parse((await body(req)).toString()).prompt;
    const img = Object.values(g).find((n) => n.class_type === 'LoadImage')?.inputs.image;
    const prompt = Object.values(g).find((n) => n.class_type === 'CLIPTextEncode')?.inputs.text;
    const id = 'p' + Date.now(); jobs[id] = { done: false, prompt };
    const out = path.join(dir, id + '.webm');
    execFile('ffmpeg', ['-y', '-loop', '1', '-i', path.join(dir, img), '-vf', "scale=640:-2,zoompan=z='1+0.03*sin(2*PI*on/48)':d=1:s=640x426:fps=16", '-t', '3', '-c:v', 'libvpx-vp9', '-b:v', '800k', '-pix_fmt', 'yuv420p', out],
      (err) => { jobs[id] = { done: true, err, file: id + '.webm', prompt }; console.log('generated', id, err ? err.message : 'ok', '| prompt:', prompt?.slice(0, 90)); });
    return json(res, { prompt_id: id, number: 1 });
  }
  const h = u.pathname.match(/^\/history\/(.+)$/);
  if (h) { const j = jobs[h[1]]; if (!j || !j.done) return json(res, {}); return json(res, { [h[1]]: { status: { status_str: j.err ? 'error' : 'success' }, outputs: { 9: { gifs: [{ filename: j.file, subfolder: '', type: 'output', format: 'video/webm' }] } } } }); }
  if (u.pathname === '/view') { const f = path.join(dir, path.basename(u.searchParams.get('filename'))); res.writeHead(200, { ...cors, 'Content-Type': 'video/webm' }); return fs.createReadStream(f).pipe(res); }
  json(res, { error: 'not found' }, 404);
}).listen(port, () => console.log('fake ComfyUI on http://127.0.0.1:' + port));
