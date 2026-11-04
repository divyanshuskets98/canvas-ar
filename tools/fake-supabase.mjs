// Local stand-in for the parts of Supabase the app uses (PostgREST, RPC, Storage, Auth),
// with the same access rules as supabase/setup.sql. For testing only.
//   node tools/fake-supabase.mjs [port=9000] [dataDir]
import http from 'http'; import fs from 'fs'; import path from 'path'; import crypto from 'crypto';
const port = +process.argv[2] || 9000;
const dir = path.resolve(process.argv[3] || '.fake-supabase'); fs.mkdirSync(dir, { recursive: true });
const ANON = 'test-anon';
const rows = new Map(); const tokens = new Set();
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { ...cors, 'Content-Type': type }); res.end(body == null ? '' : typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const role = (req) => { const t = (req.headers.authorization || '').replace('Bearer ', ''); return tokens.has(t) ? 'authenticated' : t === ANON ? 'anon' : null; };
const readBody = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
const pub = (r) => ({ id: r.id, status: r.status, result_path: r.result_path, error: r.error, updated_at: r.updated_at });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  const u = new URL(req.url, 'http://x'); const p = u.pathname; const who = role(req);
  try {
    if (p === '/auth/v1/token') {
      const b = JSON.parse((await readBody(req)).toString() || '{}');
      if (u.searchParams.get('grant_type') === 'password' && !(b.email && b.password)) return send(res, 400, { error_description: 'Invalid login credentials' });
      const t = 'adm-' + crypto.randomUUID(); tokens.add(t);
      return send(res, 200, { access_token: t, refresh_token: 'r-' + t, expires_in: 3600, token_type: 'bearer' });
    }
    const pubm = p.match(/^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
    if (pubm && req.method === 'GET') { // public bucket: no key needed
      const f = path.join(dir, pubm[1], decodeURIComponent(pubm[2])); if (!f.startsWith(dir) || !fs.existsSync(f)) return send(res, 404, { message: 'Object not found' });
      return send(res, 200, fs.readFileSync(f), JSON.parse(fs.readFileSync(f + '.meta.json', 'utf8')).type);
    }
    if (!who) return send(res, 401, { message: 'Invalid API key' });
    if (p === '/rest/v1/scans') {
      if (req.method === 'POST') {
        const b = JSON.parse((await readBody(req)).toString());
        if (who === 'anon' && (b.status !== 'pending' || b.result_path || b.claimed_by || !String(b.image_path).startsWith('scans/'))) return send(res, 403, { message: 'new row violates row-level security policy' });
        if (rows.has(b.id)) return send(res, 409, { message: 'duplicate key' });
        const now = new Date().toISOString();
        rows.set(b.id, { created_at: now, updated_at: now, status: 'pending', result_path: null, error: null, claimed_by: null, claimed_at: null, ...b });
        log('insert scan', b.id.slice(0, 8), 'session', String(b.session_id).slice(0, 8)); return send(res, 201);
      }
      if (who !== 'authenticated') return send(res, 200, []); // RLS: anon sees nothing
      const id = (u.searchParams.get('id') || '').replace('eq.', '');
      if (req.method === 'GET') return send(res, 200, [...rows.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, +(u.searchParams.get('limit') || 100)));
      if (req.method === 'PATCH') { const b = JSON.parse((await readBody(req)).toString()); if (rows.has(id)) Object.assign(rows.get(id), b); log('update', id.slice(0, 8), b.status || ''); return send(res, 204); }
      if (req.method === 'DELETE') { rows.delete(id); return send(res, 204); }
    }
    if (p === '/rest/v1/rpc/get_scan') { const b = JSON.parse((await readBody(req)).toString()); const r = rows.get(b.scan_id); return send(res, 200, r ? [pub(r)] : []); }
    if (p === '/rest/v1/rpc/claim_scan') {
      if (who !== 'authenticated') return send(res, 403, { message: 'permission denied for function claim_scan' });
      const b = JSON.parse((await readBody(req)).toString());
      const stale = Date.now() - 10 * 60 * 1000;
      const r = [...rows.values()].sort((a, c) => a.created_at.localeCompare(c.created_at)).find((x) => x.status === 'pending' || (x.status === 'processing' && Date.parse(x.claimed_at) < stale));
      if (!r) return send(res, 200, []);
      Object.assign(r, { status: 'processing', claimed_by: b.worker, claimed_at: new Date().toISOString(), updated_at: new Date().toISOString(), error: null });
      log('claimed', r.id.slice(0, 8), 'by', b.worker); return send(res, 200, [r]);
    }
    let m = p.match(/^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
    if (m && req.method === 'GET') {
      const f = path.join(dir, m[1], decodeURIComponent(m[2])); if (!f.startsWith(dir) || !fs.existsSync(f)) return send(res, 404, { message: 'Object not found' });
      const meta = JSON.parse(fs.readFileSync(f + '.meta.json', 'utf8'));
      return send(res, 200, fs.readFileSync(f), meta.type);
    }
    m = p.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);
    if (m && req.method === 'POST') {
      const name = decodeURIComponent(m[2]);
      if (who === 'anon' && !name.startsWith('scans/')) return send(res, 403, { message: 'new row violates row-level security policy' });
      const f = path.join(dir, m[1], name); if (!f.startsWith(dir)) return send(res, 400, {});
      if (fs.existsSync(f) && req.headers['x-upsert'] !== 'true') return send(res, 409, { message: 'The resource already exists' });
      fs.mkdirSync(path.dirname(f), { recursive: true });
      const body = await readBody(req); fs.writeFileSync(f, body); fs.writeFileSync(f + '.meta.json', JSON.stringify({ type: req.headers['content-type'] }));
      log('stored', name, body.length + 'B'); return send(res, 200, { Key: `${m[1]}/${name}` });
    }
    send(res, 404, { message: 'not found ' + p });
  } catch (e) { send(res, 500, { message: e.message }); }
}).listen(port, () => console.log('fake supabase on http://localhost:' + port));
