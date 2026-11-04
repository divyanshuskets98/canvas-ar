// Optional, free generative AI video: a ComfyUI server running on the admin's own PC
// (any image-to-video workflow, e.g. LTX-Video / Wan / Stable Video Diffusion).
// Export the workflow with "Save (API format)" and put these placeholders in it:
//   "{{IMAGE}}"  – LoadImage node's image field      "{{PROMPT}}" – positive prompt text
//   "{{WIDTH}}" / "{{HEIGHT}}" (numbers, optional)      "{{SEED}}"   (number, optional)
// Start ComfyUI with:  python main.py --enable-cors-header "*"
export function loadComfySettings() {
  try { return JSON.parse(localStorage.getItem('canvasAR.comfy') || 'null') || { enabled: false, url: 'http://127.0.0.1:8188', workflow: '' }; }
  catch (_) { return { enabled: false, url: 'http://127.0.0.1:8188', workflow: '' }; }
}
export function saveComfySettings(s) { try { localStorage.setItem('canvasAR.comfy', JSON.stringify(s)); } catch (_) { /* ignore */ } }

export async function comfyPing(url) {
  const r = await fetch(url.replace(/\/$/, '') + '/system_stats', { cache: 'no-store' });
  if (!r.ok) throw new Error('ComfyUI answered ' + r.status);
  return r.json();
}

function fill(workflowText, vars) {
  let t = workflowText;
  for (const [k, v] of Object.entries(vars)) {
    t = t.split(`"{{${k}}}"`).join(typeof v === 'number' ? String(v) : JSON.stringify(v)); // numeric placeholders
    t = t.split(`{{${k}}}`).join(String(v).replace(/["\\]/g, '\\$&'));                  // inside strings
  }
  return JSON.parse(t);
}

// Returns { blob, type } of the generated clip.
export async function comfyGenerate({ url, workflow }, imageBlob, { prompt, width, height, onStatus, timeoutMs = 15 * 60 * 1000 }) {
  const base = url.replace(/\/$/, '');
  onStatus?.('Uploading image to ComfyUI…');
  const fd = new FormData(); fd.append('image', imageBlob, `canvas-ar-${Date.now()}.png`); fd.append('overwrite', 'true');
  const up = await fetch(base + '/upload/image', { method: 'POST', body: fd }).then((r) => r.json());
  const graph = fill(workflow, { IMAGE: up.subfolder ? `${up.subfolder}/${up.name}` : up.name, PROMPT: prompt, WIDTH: width, HEIGHT: height, SEED: Math.floor(Math.random() * 1e9) });
  const q = await fetch(base + '/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: 'canvas-ar' }) }).then((r) => r.json());
  if (!q.prompt_id) throw new Error('ComfyUI rejected the workflow: ' + JSON.stringify(q.error || q.node_errors || q).slice(0, 300));
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 3000));
    const h = await fetch(`${base}/history/${q.prompt_id}`).then((r) => r.json());
    const job = h[q.prompt_id];
    onStatus?.(`Generating AI video… ${Math.round((Date.now() - t0) / 1000)}s`);
    if (!job) continue;
    if (job.status?.status_str === 'error') throw new Error('ComfyUI workflow failed');
    for (const out of Object.values(job.outputs || {})) {
      const f = (out.gifs || out.videos || out.images || [])[0];
      if (!f) continue;
      const r = await fetch(`${base}/view?filename=${encodeURIComponent(f.filename)}&subfolder=${encodeURIComponent(f.subfolder || '')}&type=${encodeURIComponent(f.type || 'output')}`);
      const blob = await r.blob();
      return { blob, type: blob.type || (f.filename.endsWith('.mp4') ? 'video/mp4' : f.filename.endsWith('.webm') ? 'video/webm' : 'image/gif') };
    }
  }
  throw new Error('ComfyUI timed out');
}
