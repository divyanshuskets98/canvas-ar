// Minimal Supabase REST client (PostgREST + Storage + Auth) using fetch only.
// Phones use the public anon key; the admin dashboard signs in with email/password.
import { CONFIG } from '../config.js';

const base = () => CONFIG.supabaseUrl.replace(/\/$/, '');
export const backendEnabled = () => !!(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
export const publicUrl = (path) => `${base()}/storage/v1/object/public/${CONFIG.bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;

let adminSession = null; // { access_token, refresh_token, expires_at, email }
try { adminSession = JSON.parse(sessionStorage.getItem('canvasAR.admin') || 'null'); } catch (_) { /* ignore */ }

async function token() {
  if (!adminSession) return CONFIG.supabaseAnonKey;
  if (adminSession.expires_at && Date.now() / 1000 > adminSession.expires_at - 60) await refresh();
  return adminSession.access_token;
}
function headers(tok, extra = {}) { return { apikey: CONFIG.supabaseAnonKey, Authorization: `Bearer ${tok}`, ...extra }; }
async function req(path, { method = 'GET', body, headers: h = {}, admin = false, raw = false } = {}) {
  const tok = admin ? await token() : CONFIG.supabaseAnonKey;
  const r = await fetch(base() + path, { method, body, headers: headers(tok, h) });
  if (!r.ok) {
    let msg = r.status + ' ' + r.statusText;
    try { const j = await r.json(); msg = j.message || j.error_description || j.error || msg; } catch (_) { /* no body */ }
    throw new Error(msg);
  }
  if (raw) return r;
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

// ---------------------------------------------------------------- device identity (per phone, no login)
export function sessionId() {
  let id = null;
  try { id = localStorage.getItem('canvasAR.session'); } catch (_) { /* private mode */ }
  if (!id) { id = crypto.randomUUID(); try { localStorage.setItem('canvasAR.session', id); } catch (_) { /* ignore */ } }
  return id;
}

// ---------------------------------------------------------------- phone side
export async function uploadFile(path, blob, contentType, { admin = false, upsert = false } = {}) {
  return req(`/storage/v1/object/${CONFIG.bucket}/${path}`, { method: 'POST', body: blob, admin, headers: { 'Content-Type': contentType, 'x-upsert': upsert ? 'true' : 'false', 'Cache-Control': '3600' } });
}

export async function submitScan({ id, name, imageBlob, width, height, summary }) {
  const path = `scans/${id}.jpg`;
  await uploadFile(path, imageBlob, 'image/jpeg');
  await req('/rest/v1/scans', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ id, session_id: sessionId(), name, image_path: path, width, height, scene: summary, status: 'pending' }),
  });
  return { id, image_path: path };
}

// Only returns the one scan whose id the caller knows (rows aren't listable with the anon key)
export async function getScan(id) {
  const rows = await req('/rest/v1/rpc/get_scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scan_id: id }) });
  return Array.isArray(rows) ? rows[0] || null : rows;
}

export async function fetchJSON(path) { const r = await fetch(publicUrl(path), { cache: 'no-store' }); if (!r.ok) throw new Error('fetch ' + r.status); return r.json(); }

// ---------------------------------------------------------------- admin side
export const isSignedIn = () => !!adminSession;
export const adminEmail = () => adminSession?.email;
export async function signIn(email, password) {
  const j = await req('/auth/v1/token?grant_type=password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  setSession(j, email);
}
async function refresh() {
  const j = await fetch(base() + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { apikey: CONFIG.supabaseAnonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: adminSession.refresh_token }) }).then((r) => r.json());
  if (!j.access_token) { signOut(); throw new Error('Session expired – sign in again'); }
  setSession(j, adminSession.email);
}
function setSession(j, email) {
  adminSession = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600), email };
  try { sessionStorage.setItem('canvasAR.admin', JSON.stringify(adminSession)); } catch (_) { /* ignore */ }
}
export function signOut() { adminSession = null; try { sessionStorage.removeItem('canvasAR.admin'); } catch (_) { /* ignore */ } }

export const listScans = (limit = 60) => req(`/rest/v1/scans?select=*&order=created_at.desc&limit=${limit}`, { admin: true });
export async function claimScan(worker) {
  const rows = await req('/rest/v1/rpc/claim_scan', { method: 'POST', admin: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ worker }) });
  return Array.isArray(rows) ? rows[0] || null : rows;
}
export const updateScan = (id, patch) => req(`/rest/v1/scans?id=eq.${id}`, { method: 'PATCH', admin: true, headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }) });
export const deleteScan = (id) => req(`/rest/v1/scans?id=eq.${id}`, { method: 'DELETE', admin: true, headers: { Prefer: 'return=minimal' } });
