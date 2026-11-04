# Canvas AR – living canvases in the browser

Point a phone at a registered canvas and the painting itself comes alive: the painted birds flap and glide, the boat rocks on its waves, clouds drift, diya flames flicker and relight the scene, string lights blink, water ripples, trees sway. The animation stays locked to the physical canvas (position, scale, perspective) as you move.

Every scan is also sent to an **admin dashboard**, which processes it automatically in the admin's browser and sends an improved animation back to *that* phone. Optionally, the dashboard can generate a true generative-AI video of the canvas on the admin's own PC (free, via ComfyUI).

## What it does

| Part | What happens |
|---|---|
| **Phone** (`index.html`) | Scan or upload a canvas → on-device analysis → animation starts immediately → scan is uploaded → the AI result arrives a few seconds later and replaces the on-device version (chip **AI animation ✓**; tap it to compare). |
| **Admin** (`admin.html`) | Sign in → the tab works as the processing worker: claims each new scan, analyses it with the recognition models, finds painted objects, writes a motion prompt, optionally renders an AI video with ComfyUI, records a preview, uploads the result package. Shows all scans, devices and results; *Reprocess* / *Delete* per scan. |
| **Backend** (Supabase, free tier) | Stores scans and results, and hands each scan to exactly one worker. Phones can only create scans and read the status of their own scan. |

### Animating what's painted (not adding new things)

- Painted **birds** are cut out, the sky behind them is filled in, and the cut-outs flap (with glide pauses) and hover around their original spot. Tap one to make it take off; it comes back. They never leave the canvas.
- Painted **boats/floating objects** rock and bob at their waterline and send small ripples.
- Painted **clouds** drift slowly back and forth; swiping pushes them.
- Existing **flames, bulbs, windows, stars, water, foliage and sky** are animated where they are.
- Anything that would add objects that aren't in the picture (extra bird flock, fireworks, fireflies, falling leaves, traffic trails, motes) is **off by default**. You can still add it with **+ Add**.

## Setup (one time, about 10 minutes)

1. **Create a free Supabase project** at supabase.com.
2. In Supabase → **SQL Editor**, paste and run `supabase/setup.sql`. It creates the `scans` table, the security rules and the `canvas-ar` storage bucket.
3. In Supabase → **Authentication → Users → Add user**, create the admin account (email + password). Then, in the SQL Editor, run `insert into public.admins (email) values ('your-admin@email');`. Only emails in that table can process scans. Also switch off *Allow new users to sign up* under Authentication → Providers → Email.
4. In Supabase → **Project Settings → API**, copy the *Project URL* and the *anon public* key into `js/config.js`.
5. Upload the folder to the GitHub repository again (drag the folder's contents onto *Add file → Upload files*). The existing Pages workflow redeploys it automatically.
6. Open `https://<you>.github.io/canvas-ar/admin.html` on a PC, sign in, and **leave the tab open and visible**. That tab is the worker.

Phones just open `https://<you>.github.io/canvas-ar/`.

### Optional: free generative AI video (ComfyUI on the admin PC)

This needs a PC with a capable NVIDIA GPU.

1. Install ComfyUI and an image-to-video model and workflow (for example LTX-Video or Wan 2.x).
2. Start ComfyUI with `python main.py --enable-cors-header "*"`.
3. In the workflow, put `"{{IMAGE}}"` in the LoadImage node and `{{PROMPT}}` in the positive prompt. `{{WIDTH}}`, `{{HEIGHT}}` and `{{SEED}}` are optional placeholders. Set the output to an **MP4 video**.
4. Export with *Save (API format)*, then paste it into the dashboard under **AI video settings** and enable it.

Each scan's prompt is written automatically from the analysis. For example: *"the 4 birds flap their wings and glide gently in place, gentle ocean waves roll… keep the exact composition… static camera, no new objects, seamless loop"*. Phones then play the clip on the tracked canvas.

If the dashboard is served over HTTPS (GitHub Pages) and the browser blocks calls to `http://127.0.0.1`, open the dashboard from the PC itself instead: run `node tools/serve.mjs` and go to `http://localhost:8080/admin.html`.

## Why there is no ChatGPT browser automation

Driving the ChatGPT website with a bot is against OpenAI's terms of use (scripted access is only allowed through their paid API). It also breaks whenever the site changes, and ChatGPT can't reliably turn a painting into a faithful animated loop. The dashboard does the same job instead: scan arrives, AI analysis runs, the animation is generated, and the result returns to the phone with no manual step. For true generative video it uses a free model on your own PC.

## Multi-user

- Each phone gets an anonymous device id. Each scan gets an unguessable id, and a phone only ever polls its own scan ids, so results can't cross between users.
- Workers claim scans atomically (`claim_scan`, `FOR UPDATE SKIP LOCKED`), so several admin tabs can run in parallel without processing the same scan twice. If a scan is stuck because a tab was closed, it is handed out again after 10 minutes.
- Tracking and rendering run entirely on each phone, so users never affect each other's sessions.

## Local testing

```
node tools/serve.mjs                 # app on http://localhost:8080
node tools/fake-supabase.mjs 9000    # local stand-in for Supabase (same access rules)
node tools/fake-comfyui.mjs 8188     # optional: stand-in ComfyUI (needs ffmpeg)
```

To use the local backend, open `index.html?backend=http://localhost:9000` and `admin.html?backend=http://localhost:9000`. Any email and password work with the fake backend, and these parameters are only honoured on localhost.

The headless tests (`tools/*-e2e.mjs`, Playwright) cover:

- `multiuser-e2e` – two phones with fake cameras scan different canvases at the same time; the admin processes both; each phone must receive its own result.
- `video-e2e` – the AI-video path end to end.
- `ar-e2e`, `scan-e2e`, `multi-e2e` – tracking.

`dev/objects.html` and `dev/analyzer.html` show what the vision code finds on the demo canvases.

## Honest limits

- **Registration:** a canvas has to be scanned or uploaded once before it can be tracked.
- **Object detection is heuristic:** it finds dark birds against a bright sky, boats on water and white clouds in a blue sky. Unusual art styles may be missed or misread, and every effect can be toggled. Detection needs a reasonably sharp scan: birds smaller than about 1% of the canvas width get skipped, so scan close and straight-on.
- **Without ComfyUI**, the admin result uses the same animation engine as the phone, with fuller analysis (recognition models, finer light-source pass) and a recorded preview. True generative motion (for example a person walking) needs the ComfyUI option.
- **The backend is open to anyone with the link:** anyone with the app link can submit scans (no login for phones), and scan images live in a public bucket under random names. For a closed event, add Supabase Auth for phones too.
- Tracking and performance have been verified with synthetic camera feeds in headless Chromium, not on physical phones.
