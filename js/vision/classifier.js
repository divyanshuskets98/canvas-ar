// Fuses pixel cues + ML labels/objects into theme scores. Themes are not exclusive –
// a rainy city at night scores on rain, city and night at once, and the composer
// mixes behaviours from all of them.
import { analyzeImage } from './analyzer.js';
import { recognise } from './models.js';

const c01 = (v) => Math.max(0, Math.min(1, v));
const ramp = (a, b, v) => c01((v - a) / (b - a));

// ImageNet label fragments → theme evidence
const LABEL_HINTS = {
  festival: ['candle', 'torch', 'lampshade', 'jack-o', 'matchstick', 'table lamp', 'spotlight', 'lantern', 'christmas', 'bonfire'],
  rain: ['umbrella', 'poncho', 'raincoat', 'window screen'],
  ocean: ['seashore', 'sandbar', 'promontory', 'breakwater', 'liner', 'schooner', 'catamaran', 'trimaran', 'yawl', 'speedboat', 'lifeboat', 'pirate', 'wreck', 'coral reef', 'fireboat', 'container ship', 'submarine', 'surfboard', 'beacon'],
  lake: ['lakeside', 'boathouse', 'dock', 'canoe', 'paddle', 'gondola', 'dam'],
  nature: ['valley', 'alp', 'cliff', 'volcano', 'hay', 'daisy', 'rapeseed', 'geyser', 'butterfly', 'bee', 'mushroom', 'pot', 'greenhouse', 'maze', 'stone wall', 'worm fence', 'picket fence', 'barn'],
  city: ['streetcar', 'cab', 'traffic light', 'street sign', 'trolleybus', 'passenger car', 'palace', 'church', 'mosque', 'monastery', 'planetarium', 'bell cote', 'cinema', 'library', 'tram', 'limousine', 'police van', 'minibus', 'suspension bridge', 'steel arch bridge'],
  snow: ['ski', 'snowmobile', 'dogsled', 'igloo', 'snowplow', 'bobsled'],
  night: ['planetarium', 'spotlight'],
};
const OBJECT_HINTS = {
  boat: { ocean: 0.35, lake: 0.25 }, bird: { nature: 0.1 }, umbrella: { rain: 0.35 },
  car: { city: 0.25 }, bus: { city: 0.3 }, truck: { city: 0.2 }, 'traffic light': { city: 0.35 },
  'potted plant': { nature: 0.15 }, kite: { nature: 0.1 }, skis: { snow: 0.4 }, snowboard: { snow: 0.4 },
  surfboard: { ocean: 0.4 }, bench: { nature: 0.05, city: 0.05 },
};

export function scoreThemes(scene, ml) {
  const k = scene.cues, s = scene.stats;
  const label = (theme) => {
    let v = 0;
    for (const l of ml?.labels || []) if (LABEL_HINTS[theme].some((f) => l.name.includes(f))) v = Math.max(v, l.score);
    return v;
  };
  const obj = (theme) => {
    let v = 0;
    for (const o of ml?.objects || []) { const h = OBJECT_HINTS[o.label]; if (h && h[theme]) v += h[theme] * o.score; }
    return Math.min(0.6, v);
  };

  const night = c01(ramp(0.38, 0.12, s.meanL) * 0.7 + (k.skyType === 'night' ? 0.4 : 0) + ramp(0, 30, k.stars) * 0.2 + label('night') * 0.3);
  const colourful = ramp(1, 4, k.lightHueVariety);
  const festival = c01(ramp(0, 4, k.flames) * 0.55 + ramp(4, 24, k.lights) * colourful * (0.3 + night * 0.3) + night * ramp(0, 2, k.flames) * 0.15 + label('festival') * 0.6);
  const grey = ramp(0.35, 0.8, s.grey);
  const rain = c01(grey * 0.3 + (k.skyType === 'overcast' ? 0.25 : 0) + ramp(0.014, 0.03, k.streakDensity) * ramp(0.2, 0.5, k.streakCoherence) * 0.5 * (0.3 + 0.7 * Math.max(grey, k.skyType === 'overcast' ? 1 : 0)) + label('rain') * 0.5 + obj('rain'));
  const ocean = c01(ramp(0.12, 0.35, k.waterArea) * ramp(0.7, 0.95, k.waterSpan) * 0.75 + label('ocean') * 0.6 + obj('ocean'));
  const lake = c01(ramp(0.02, 0.15, k.waterArea) * 0.6 + label('lake') * 0.5 + obj('lake'));
  const nature = c01(ramp(0.05, 0.35, k.vegArea) * 0.75 + label('nature') * 0.5 + obj('nature') + ramp(0.02, 0.12, k.autumnArea) * 0.3);
  const city = c01(ramp(6, 60, k.windows) * 0.5 + ramp(0.45, 0.8, k.rectilinear) * ramp(0.25, 0.5, k.vertical) * 0.35 + label('city') * 0.5 + obj('city'));
  const snow = c01(ramp(0.05, 0.3, k.snowArea) * 0.75 + label('snow') * 0.6 + obj('snow'));
  const sunset = c01((k.skyType === 'sunset' ? 0.7 : 0) + ramp(0.15, 0.5, k.sky.warm) * 0.3);
  const day = c01((k.skyType === 'day' ? 0.7 : 0) + ramp(0.45, 0.7, s.meanL) * 0.3);
  // orange texture alone (pottery, rangoli, sunsets) isn't autumn – it needs a landscape context
  const autumn = c01(ramp(0.02, 0.15, k.autumnArea) * 0.8 * (k.vegArea > 0.02 || label('nature') > 0.2 ? 1 : 0.25));
  return { festival, rain, ocean, lake, nature, city, snow, night, sunset, day, autumn };
}

export const THEME_LABELS = {
  festival: 'Festival lights', rain: 'Rain', ocean: 'Ocean', lake: 'Water', nature: 'Nature', city: 'City',
  snow: 'Snow', night: 'Night', sunset: 'Sunset', day: 'Daylight', autumn: 'Autumn',
};

// Full pipeline: pixels (sync, ~50 ms) + optional ML (async, first run downloads models).
export async function understand(img, { useML = true, mlTimeout = 15000, onStage } = {}) {
  onStage?.('Reading colours, regions and light sources…');
  const scene = analyzeImage(img);
  let ml = { labels: [], objects: [], available: false, errors: [] };
  if (useML) {
    onStage?.('Recognising objects…');
    try { ml = await recognise(img, { timeout: mlTimeout }); } catch (e) { ml.errors.push(String(e)); }
  }
  scene.ml = ml;
  scene.objects = ml.objects;
  scene.themes = scoreThemes(scene, ml);
  scene.topThemes = Object.entries(scene.themes).filter(([, v]) => v >= 0.3).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  return scene;
}
