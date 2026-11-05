// Optional, free generative AI video: a ComfyUI server running on the admin's own PC
// (any image-to-video workflow, e.g. LTX-Video / Wan / Stable Video Diffusion).
// Export the workflow with "Save (API format)" and put these placeholders in it:
//   "{{IMAGE}}"  – LoadImage node's image field      "{{PROMPT}}" – positive prompt text
//   "{{WIDTH}}" / "{{HEIGHT}}" (numbers, optional)      "{{SEED}}"   (number, optional)
// Start ComfyUI with:  python main.py --enable-cors-header "*"
export function loadComfySettings() {
  const def = { enabled: false, url: 'http://127.0.0.1:8188', workflow: '', extraPrompt: '', longSide: 832 };
  try { return { ...def, ...(JSON.parse(localStorage.getItem('canvasAR.comfy') || 'null') || {}) }; }
  catch (_) { return def; }
}
export function saveComfySettings(s) { try { localStorage.setItem('canvasAR.comfy', JSON.stringify(s)); } catch (_) { /* ignore */ } }

// The "Canvas AR - living canvas" workflow is stored inside ComfyUI itself (user data),
// so the dashboard can load it without any copy/paste.
export async function loadSavedWorkflow(url) {
  const r = await fetch(url.replace(/\/$/, '') + '/api/userdata/' + encodeURIComponent('canvas-ar/workflow-api.json'), { cache: 'no-store' });
  if (!r.ok) throw new Error('no Canvas AR workflow saved in this ComfyUI (' + r.status + ')');
  return r.text();
}

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
  const g = JSON.parse(t);
  // No placeholders needed: wire the scan into an unmodified template automatically.
  if (!workflowText.includes('{{IMAGE}}')) for (const n of Object.values(g)) if (n.class_type === 'LoadImage') n.inputs.image = vars.IMAGE;
  // A vision-language node (e.g. TextGenerate + Qwen3-VL) in the workflow writes the motion prompt
  // itself from the image; the dashboard only appends the admin's optional standing instruction.
  const vlm = Object.values(g).filter((n) => /^TextGenerate/.test(n.class_type || '') && typeof n.inputs?.prompt === 'string');
  if (vlm.length && vars.EXTRA) vlm.forEach((n) => (n.inputs.prompt += ' Additional instruction: ' + vars.EXTRA));
  for (const n of Object.values(g)) if (n.class_type === 'KSampler' && typeof n.inputs?.seed === 'number') n.inputs.seed = vars.SEED;
  if (!workflowText.includes('{{PROMPT}}') && !vlm.length) {
    // the positive prompt = the text-encode node feeding some node's "positive" input
    const posIds = new Set(Object.values(g).map((n) => n.inputs?.positive).filter(Array.isArray).map((l) => String(l[0])));
    for (const [id, n] of Object.entries(g)) if (n.class_type === 'CLIPTextEncode' && posIds.has(id) && typeof n.inputs.text === 'string') n.inputs.text = vars.PROMPT;
  }
  // match the canvas aspect ratio on image-to-video nodes (e.g. LTXVImgToVideo, WanImageToVideo)
  for (const n of Object.values(g)) {
    if (/ImgToVideo|ImageToVideo/i.test(n.class_type || '') && typeof n.inputs?.width === 'number' && typeof n.inputs?.height === 'number' && !workflowText.includes('{{WIDTH}}')) {
      n.inputs.width = vars.WIDTH; n.inputs.height = vars.HEIGHT;
    }
    // the first frame must be the canvas itself: full image conditioning strength
    if (/ImgToVideo|ImageToVideo/i.test(n.class_type || '') && typeof n.inputs?.strength === 'number' && n.inputs.strength < 1) n.inputs.strength = 1;
  }
  return g;
}

// Returns { blob, type } of the generated clip.
export async function comfyGenerate({ url, workflow, extraPrompt }, imageBlob, { prompt, width, height, onStatus, timeoutMs = 45 * 60 * 1000 }) {
  const base = url.replace(/\/$/, '');
  onStatus?.('Uploading image to ComfyUI…');
  const fd = new FormData(); fd.append('image', imageBlob, `canvas-ar-${Date.now()}.png`); fd.append('overwrite', 'true');
  const up = await fetch(base + '/upload/image', { method: 'POST', body: fd }).then((r) => r.json());
  const graph = fill(workflow, { IMAGE: up.subfolder ? `${up.subfolder}/${up.name}` : up.name, PROMPT: prompt, EXTRA: extraPrompt || '', WIDTH: width, HEIGHT: height, SEED: Math.floor(Math.random() * 1e9) });
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
    // text written by the vision model (shown in the dashboard)
    const text = Object.values(job.outputs || {}).map((o) => o.text).filter(Boolean).flat().join(' ').trim() || null;
    for (const out of Object.values(job.outputs || {})) {
      const f = [...(out.videos || []), ...(out.gifs || []), ...(out.images || [])].find((x) => /\.(mp4|webm|mov|gif|webp)$/i.test(x.filename)) || (out.gifs || out.videos || [])[0];
      if (!f) continue;
      const r = await fetch(`${base}/view?filename=${encodeURIComponent(f.filename)}&subfolder=${encodeURIComponent(f.subfolder || '')}&type=${encodeURIComponent(f.type || 'output')}`);
      const blob = await r.blob();
      const type = /\.mp4$/i.test(f.filename) ? 'video/mp4' : /\.webm$/i.test(f.filename) ? 'video/webm' : blob.type || 'image/gif';
      return { blob: new Blob([blob], { type }), type, text };
    }
  }
  throw new Error('ComfyUI timed out');
}
