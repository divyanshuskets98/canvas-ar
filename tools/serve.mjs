// Minimal static server for local testing: node tools/serve.mjs [dir=.] [port=8080]
import http from 'http'; import fs from 'fs'; import path from 'path';
const root = path.resolve(process.argv[2] || '.'); const port = +process.argv[3] || 8080;
const types = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json', '.wasm':'application/wasm', '.jpg':'image/jpeg', '.png':'image/png', '.svg':'image/svg+xml', '.tflite':'application/octet-stream', '.mind':'application/octet-stream', '.webmanifest':'application/manifest+json' };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p); if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.stat(f, (e, st) => { if (e || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') return res.end(); fs.createReadStream(f).pipe(res); });
}).listen(port, () => console.log(`Serving ${root} on http://localhost:${port}`));
