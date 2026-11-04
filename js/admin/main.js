import { backendEnabled, isSignedIn, signIn, signOut, adminEmail, listScans, claimScan, updateScan, deleteScan, publicUrl } from '../backend/client.js';
import { processScan } from './pipeline.js';
import { loadComfySettings, saveComfySettings, comfyPing } from './comfy.js';

const $ = (s) => document.querySelector(s);
const show = (id) => ['setup', 'login', 'dash'].forEach((x) => ($('#' + x).hidden = x !== id));
const worker = 'admin-' + Math.random().toString(36).slice(2, 8);
let busy = false, scans = [], comfy = loadComfySettings(), wakeLock = null;
window.canvasARAdmin = { get busy() { return busy; }, get scans() { return scans; } };

function log(msg) {
  const el = $('#log'); const line = `${new Date().toLocaleTimeString()}  ${msg}\n`;
  el.textContent = (line + el.textContent).slice(0, 20000);
  console.log('[worker]', msg);
}
const ago = (iso) => { const s = (Date.now() - Date.parse(iso)) / 1000; return s < 60 ? Math.round(s) + 's ago' : s < 3600 ? Math.round(s / 60) + ' min ago' : new Date(iso).toLocaleString(); };

// ------------------------------------------------------------------ boot
if (!backendEnabled()) show('setup');
else if (!isSignedIn()) show('login');
else startDashboard();

$('#loginForm').onsubmit = async (e) => {
  e.preventDefault(); $('#loginErr').textContent = '';
  try { await signIn($('#email').value.trim(), $('#password').value); startDashboard(); }
  catch (err) { $('#loginErr').textContent = err.message; }
};
$('#btnLogout').onclick = () => { signOut(); location.reload(); };

// ------------------------------------------------------------------ dashboard
let pollTimer;
function startDashboard() {
  show('dash');
  $('#who').textContent = adminEmail() || '';
  refresh(); pollTimer = setInterval(refresh, 4000);
  setInterval(workLoop, 2000);
  keepAwake();
  document.addEventListener('visibilitychange', () => { $('#tabWarn').hidden = !document.hidden; if (!document.hidden) keepAwake(); });
}
async function keepAwake() { try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => (wakeLock = null)); } } catch (_) { /* not allowed */ } }

async function refresh() {
  try { scans = await listScans(80); render(); }
  catch (e) { log('List failed: ' + e.message); if (/JWT|expired|sign in/i.test(e.message)) { signOut(); location.reload(); } }
}

function render() {
  const c = (s) => scans.filter((x) => x.status === s).length;
  $('#stPending').textContent = c('pending') + ' waiting'; $('#stProc').textContent = c('processing') + ' processing';
  $('#stDone').textContent = c('done') + ' done'; $('#stFail').textContent = c('failed') + ' failed';
  $('#stUsers').textContent = new Set(scans.map((s) => s.session_id)).size + ' devices';
  const list = $('#list');
  const seen = new Set();
  for (const s of scans) {
    seen.add(s.id);
    let card = list.querySelector(`[data-id="${s.id}"]`);
    const key = s.status + '|' + s.updated_at;
    if (card && card.dataset.key === key) continue;
    if (!card) { card = document.createElement('div'); card.className = 'scan'; card.dataset.id = s.id; list.appendChild(card); }
    card.dataset.key = key;
    const themes = (s.scene?.themes || []).slice(0, 3).join(' · ');
    card.innerHTML = `
      <div class="media"><img alt="scan" src="${publicUrl(s.image_path)}"><div class="ph result">${s.status === 'done' ? 'loading…' : s.status === 'failed' ? 'failed' : 'waiting for result'}</div></div>
      <div class="body"><b></b>
        <span><span class="badge ${s.status}">${s.status}</span> <span class="meta">${ago(s.created_at)}</span></span>
        <span class="meta">device ${s.session_id.slice(0, 8)} · ${s.width || '?'}×${s.height || '?'}${themes ? ' · ' + themes : ''}</span>
        <span class="meta err"></span></div>
      <div class="acts"><button class="btn" data-a="redo">Reprocess</button><button class="btn" data-a="del">Delete</button></div>`;
    card.querySelector('b').textContent = s.name || 'Untitled canvas';
    card.querySelector('.err').textContent = s.error || '';
    card.querySelector('[data-a=redo]').onclick = async () => { await updateScan(s.id, { status: 'pending', result_path: null, claimed_by: null, error: null }); log('Re-queued ' + s.id.slice(0, 8)); refresh(); };
    card.querySelector('[data-a=del]').onclick = async () => { if (confirm('Delete this scan record?')) { await deleteScan(s.id); card.remove(); refresh(); } };
    if (s.status === 'done' && s.result_path) showResult(card, s);
  }
  list.querySelectorAll('.scan').forEach((el) => { if (!seen.has(el.dataset.id)) el.remove(); });
}
async function showResult(card, s) {
  try {
    const m = await fetch(publicUrl(s.result_path), { cache: 'no-store' }).then((r) => r.json());
    const slot = card.querySelector('.result');
    const src = m.video || m.preview;
    if (src) {
      const v = document.createElement('video'); v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true; v.crossOrigin = 'anonymous';
      v.src = publicUrl(src); slot.replaceWith(v);
    } else slot.textContent = 'live package (no preview)';
    const meta = card.querySelector('.err');
    meta.textContent = `${m.mode === 'video' ? 'AI video' : 'Live animation'} · ${m.plan.map((p) => p.id).join(', ') || '—'} · ${m.summary.birds} birds, ${m.summary.boats} boats, ${m.summary.clouds} clouds · ${Math.round(m.ms / 100) / 10}s` + (m.aiNote ? ' · ' + m.aiNote : '');
  } catch (e) { /* manifest not yet visible */ }
}

// ------------------------------------------------------------------ worker
async function workLoop() {
  if (busy || !$('#auto').checked) return;
  busy = true;
  try {
    const scan = await claimScan(worker);
    if (!scan) { setState('Idle – waiting for scans'); return; }
    log(`Claimed ${scan.id.slice(0, 8)} “${scan.name}” from device ${scan.session_id.slice(0, 8)}`);
    setState('Processing ' + (scan.name || scan.id.slice(0, 8)), true);
    try {
      const m = await processScan(scan, { worker, comfy, useML: new URLSearchParams(location.search).get('ml') !== '0', onStatus: (t) => setState(`${scan.name || 'scan'}: ${t}`, true) });
      log(`Done ${scan.id.slice(0, 8)} in ${(m.ms / 1000).toFixed(1)}s → ${m.mode}, ${m.plan.length} simulations`);
    } catch (e) {
      log(`Failed ${scan.id.slice(0, 8)}: ${e.message}`);
      await updateScan(scan.id, { status: 'failed', error: e.message.slice(0, 300) }).catch(() => {});
    }
    refresh();
  } catch (e) { log('Worker error: ' + e.message); }
  finally { busy = false; }
}
function setState(t, on) { const s = $('#workerState'); s.textContent = t; s.classList.toggle('busy', !!on); }

// ------------------------------------------------------------------ ComfyUI settings
$('#btnSettings').onclick = () => {
  $('#cfEnabled').checked = comfy.enabled; $('#cfUrl').value = comfy.url; $('#cfWorkflow').value = comfy.workflow; $('#cfMsg').textContent = '';
  $('#settingsModal').hidden = false;
};
document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => (b.closest('.modal').hidden = true)));
$('#cfSave').onclick = () => {
  const wf = $('#cfWorkflow').value.trim();
  if (wf) { try { JSON.parse(wf.replace(/"\{\{(WIDTH|HEIGHT|SEED)\}\}"/g, '0')); } catch (e) { $('#cfMsg').textContent = 'Workflow is not valid JSON: ' + e.message; return; } }
  if ($('#cfEnabled').checked && wf && !wf.includes('LoadImage')) { $('#cfMsg').textContent = 'This workflow has no LoadImage node – use an image-to-video workflow.'; return; }
  comfy = { enabled: $('#cfEnabled').checked, url: $('#cfUrl').value.trim() || 'http://127.0.0.1:8188', workflow: wf };
  saveComfySettings(comfy); $('#cfMsg').textContent = 'Saved.';
};
$('#cfTest').onclick = async () => {
  $('#cfMsg').textContent = 'Checking…';
  try { const s = await comfyPing($('#cfUrl').value.trim() || 'http://127.0.0.1:8188'); $('#cfMsg').textContent = 'Connected: ComfyUI ' + (s.system?.comfyui_version || '') + ' · ' + (s.devices?.[0]?.name || 'device ok'); }
  catch (e) { $('#cfMsg').textContent = 'Not reachable (' + e.message + '). Is ComfyUI running with --enable-cors-header "*"?'; }
};
