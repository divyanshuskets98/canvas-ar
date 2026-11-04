// Optional on-device ML (MediaPipe Tasks Vision, WASM + GPU): ImageNet classification
// and COCO object detection. Everything degrades gracefully – if models can't be
// fetched (offline, blocked) the pixel analyser alone drives the simulation.

import { CONFIG } from '../config.js';
const WASM_PATH = new URL('../../vendor/mediapipe/wasm', import.meta.url).href;
const MODELS = {
  classifier: {
    local: new URL('../../models/efficientnet_lite0.tflite', import.meta.url).href,
    remote: 'https://storage.googleapis.com/mediapipe-models/image_classifier/efficientnet_lite0/float32/1/efficientnet_lite0.tflite',
  },
  detector: {
    local: new URL('../../models/efficientdet_lite0.tflite', import.meta.url).href,
    remote: 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite',
  },
};

let loading = null;

async function pickModel(m) {
  if (!CONFIG.localModels) return m.remote; // set localModels: true after running tools/fetch-models.*
  try {
    const r = await fetch(m.local, { method: 'HEAD' });
    if (r.ok && (r.headers.get('content-length') | 0) > 100000) return m.local;
  } catch (_) { /* fall through */ }
  return m.remote;
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

export function loadModels({ timeout = 15000 } = {}) {
  if (loading) return loading;
  loading = (async () => {
    const vision = await import('../../vendor/mediapipe/vision_bundle.mjs');
    const fileset = await vision.FilesetResolver.forVisionTasks(WASM_PATH);
    const make = async (Kind, model, extra) => {
      const path = await pickModel(model);
      const opts = (delegate) => ({ baseOptions: { modelAssetPath: path, delegate }, runningMode: 'IMAGE', ...extra });
      try { return await Kind.createFromOptions(fileset, opts('GPU')); }
      catch (_) { return await Kind.createFromOptions(fileset, opts('CPU')); }
    };
    const [classifier, detector] = await Promise.allSettled([
      withTimeout(make(vision.ImageClassifier, MODELS.classifier, { maxResults: 10 }), timeout),
      withTimeout(make(vision.ObjectDetector, MODELS.detector, { maxResults: 20, scoreThreshold: 0.3 }), timeout),
    ]);
    return {
      classifier: classifier.status === 'fulfilled' ? classifier.value : null,
      detector: detector.status === 'fulfilled' ? detector.value : null,
      errors: [classifier, detector].filter((r) => r.status === 'rejected').map((r) => String(r.reason?.message || r.reason)),
    };
  })().catch((e) => ({ classifier: null, detector: null, errors: [String(e?.message || e)] }));
  return loading;
}

// Run both models on an image/canvas. Returns { labels, objects, available }.
export async function recognise(img, { timeout } = {}) {
  const m = await loadModels({ timeout });
  const out = { labels: [], objects: [], available: !!(m.classifier || m.detector), errors: m.errors };
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  try {
    if (m.classifier) {
      const r = m.classifier.classify(img);
      out.labels = (r.classifications?.[0]?.categories || []).map((c) => ({ name: c.categoryName.toLowerCase(), score: c.score }));
    }
  } catch (e) { out.errors.push('classify: ' + e.message); }
  try {
    if (m.detector) {
      const r = m.detector.detect(img);
      out.objects = (r.detections || []).map((d) => ({
        label: d.categories[0].categoryName.toLowerCase(), score: d.categories[0].score,
        box: { nx: d.boundingBox.originX / W, ny: d.boundingBox.originY / H, nw: d.boundingBox.width / W, nh: d.boundingBox.height / H },
      }));
    }
  } catch (e) { out.errors.push('detect: ' + e.message); }
  return out;
}
