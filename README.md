# Canvas AR – living canvases in the browser

Point a phone camera at a registered canvas and it comes alive: diya flames flicker and relight the painting, string lights blink, fireworks burst in the sky, rain falls with splashes and lightning, clouds drift, water waves and ripples, foliage sways, birds fly, stars twinkle, city windows switch on and off. Everything is anchored to the physical canvas and keeps its position, scale and perspective as you move.

No app install, no server-side processing, no build step: plain HTML + ES modules.

## Run it

| Where | How |
|---|---|
| **Desktop preview** (no camera) | `node tools/serve.mjs` → open `http://localhost:8080` → *Demo canvases → Add & preview*. Move the mouse to change the viewing angle. |
| **Phone (real AR)** | The camera needs **HTTPS**. Easiest: drag this folder onto [Netlify Drop](https://app.netlify.com/drop) or push it to GitHub Pages, then open the URL on the phone. For local testing: `node tools/serve.mjs` plus a tunnel such as `npx localtunnel --port 8080` or `cloudflared tunnel --url http://localhost:8080`. |

Any static web server works; `tools/serve.mjs` is only a convenience (Node 18+). On Windows the ML models can be stored locally for offline use: `powershell -ExecutionPolicy Bypass -File tools\fetch-models.ps1`.

### Using it

1. **Register a canvas**: *Scan a new canvas* (frame it in the guide, straight-on, even light) or *Use the artwork file* (best for prints – upload the original image). Takes ~5–15 s on a phone.
2. **Start AR** and point at the canvas. Every registered canvas is recognised; the app switches simulation automatically when you move to another one.
3. **Interact**: tap things (flames flare, lights change pattern, sky gets lightning/fireworks/shooting stars, water ripples, trees shake, birds scatter, building lights switch). **Swipe across the canvas to blow wind** (rain slants, flames bend or nearly go out, clouds and leaves follow). **Long-press** to see what the AI found at that spot.
4. Chips at the bottom toggle simulations; tap an active chip for an intensity slider; **+ Add** mixes in anything else (put snow on a beach, fireworks over a city…). ⚙ settings: *effects only* blend mode, *show what the AI sees*, tracking stability, brightness match. ♪ turns on the procedural soundscape.

## How it works

```
camera frame / artwork ──► vision/analyzer.js   pixel analysis → soft masks (sky, water, foliage, snow, autumn),
                    │                          light blobs (flame, string light, star, window, sun/moon, lamp, glint),
                    │                          skyline/horizon, colour stats, rain-streak coherence
                    ├────► vision/models.js     MediaPipe EfficientNet-Lite (ImageNet labels) + EfficientDet (COCO objects), optional
                    │      vision/classifier.js fuses both into theme scores (festival, rain, ocean, lake, nature, city, snow, night, sunset…)
                    └────► ar/tracker.js        MindAR compiles the image into a tracking target in-browser; multiple targets merged
sim/engine.js   every behaviour scores itself against the scene graph → best fits auto-enabled, placed on detected regions
sim/livingCanvas.js   one shader re-renders the canvas: region-masked waves/ripples, foliage sway, sky billow, procedural
                      clouds, stars, sun rays, heat shimmer, bobbing boats, night, wetness, lightning, dynamic relighting
sim/behaviours/*      particle & sprite layers: flames, blinking lights, windows, fireworks, rain, snow, birds, fireflies, leaves…
```

Key design points:

- **Generated, not canned.** Simulations aren't per-theme videos. Flames are spawned on each detected flame blob, at its size; blinking lights reuse each bulb's own colour and switch the painted bulb "off" by covering it with its sampled background; ripples are clipped to the detected water and squashed by perspective; fireworks relight the painting in their own colour. Themes combine freely (rainy + city + night).
- **Anchored and 3D.** Content lives in canvas-local space under the tracked anchor. Rain, snow, motes and fireflies sit in a volume *in front* of the canvas (real parallax) and are clipped as if the canvas were a window, so nothing spills onto the wall.
- **Extensible.** A new behaviour is one object `{ id, name, score(scene), available(scene), create(ctx) }` added to `BEHAVIOURS` in `sim/engine.js`.
- **Private.** Everything runs on the device; registered canvases are stored in the browser's IndexedDB.

## Honest limits

- **"Any canvas" means any *registered* canvas.** Stable image tracking needs a reference image, so a canvas has to be scanned or uploaded once (a few seconds). After that it's recognised instantly whenever the camera sees it.
- **Recognition is heuristic plus generic models**, not a model trained on paintings. It handles clear scenes well; abstract or stylised art may get odd picks. That's why every simulation can be toggled or added manually.
- **The overlay is a re-render of the captured image**, so a scan taken in different light can look slightly off. Use the artwork file for prints, *brightness match*, or *effects only* mode.
- **Tracking needs texture.** Very plain, low-contrast or glossy (glare) canvases track poorly; screens can show moiré.
- The on-device ML models are fetched from Google's MediaPipe storage on first use (or from `models/`); if unavailable, the app falls back to pixel analysis only.

## Project layout

```
index.html, css/app.css, manifest.webmanifest
js/main.js                 app flow, UI, scanner, AR & preview loops
js/vision/                 analyzer.js, models.js, classifier.js
js/ar/                     tracker.js (MindAR wrapper), preview.js (no-camera mode)
js/sim/                    engine.js, livingCanvas.js, audio.js, common.js, behaviours/*.js
js/ui/interaction.js       tap / drag / long-press ray-casting
vendor/                    three.js 0.160.1, MindAR 1.2.5, MediaPipe tasks-vision 0.10.14 (MIT / Apache-2.0)
samples/                   five demo canvases (print or show on a screen to test)
dev/analyzer.html          debug view of masks, blobs and theme scores for the samples
tools/                     serve.mjs, fetch-models.*, make-samples.mjs, headless tests (*-e2e.mjs, still.mjs; need Playwright)
```

### Tests

The `tools/*-e2e.mjs` scripts drive headless Chromium with a fake webcam (`--use-file-for-fake-video-capture`) to check the full pipeline: scan → analyse → compile target → track → render, including two canvases at once. `tools/still.mjs` renders deterministic preview frames (`index.html?preview=diwali&still=1`).
