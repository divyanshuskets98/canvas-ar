// Backend configuration (Supabase). Fill these two values in after creating your
// Supabase project (Project Settings → API). The anon key is designed to be public;
// access is restricted by the row-level-security rules in supabase/setup.sql.
export const CONFIG = {
  supabaseUrl: 'https://ggkfaqhkryuvjzkjgnpv.supabase.co',      // project URL only – no /rest/v1
  supabaseAnonKey: 'sb_publishable_e4pKthsZ1upKsExYinuKyg_lT96ci1T',  // the "anon public" key
  bucket: 'canvas-ar',
  pollMs: 3000,         // how often a phone checks for its AI result
  localModels: false,   // true once the ML models are stored in models/ (tools/fetch-models.*)
};

// Local testing only: ?backend=http://localhost:9000&anon=test is honoured when the app
// itself runs on localhost, so a public link can't redirect scans to another server.
(() => {
  try {
    const p = new URLSearchParams(location.search);
    const local = ['localhost', '127.0.0.1'].includes(location.hostname);
    if (local && p.get('backend')) { CONFIG.supabaseUrl = p.get('backend'); CONFIG.supabaseAnonKey = p.get('anon') || 'test-anon'; }
  } catch (_) { /* not in a browser */ }
})();
