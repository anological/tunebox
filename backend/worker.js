/* Tunebox backend — Cloudflare Worker (free tier).
 *
 * What it does: proxies YouTube Data API v3 requests so the API key lives
 * ONLY on the server, never in the app's JavaScript. The frontend calls
 *   GET /api/yt/search?q=...      → YouTube search.list (music videos)
 *   GET /api/yt/trending          → YouTube most-popular music videos (cached 1h)
 * and gets back slimmed-down JSON the app can render directly.
 *
 * Setup: paste this file into a new Cloudflare Worker, then add a secret
 * named YT_API_KEY (Worker Settings → Variables → Secrets) containing your
 * YouTube Data API v3 key. Deploy, copy the workers.dev URL, and paste it
 * into Tunebox (Free Music → YouTube tab → Backend URL).
 */

const ALLOWED_ORIGINS = [
  'https://anological.github.io', // live site
  'http://127.0.0.1:8000',        // local dev
];

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

const isoSecs = iso => {
  const m = String(iso || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
};

const slimSearch = j =>
  (j.items || []).filter(i => i.id && i.id.videoId).map(i => ({
    id: i.id.videoId,
    title: (i.snippet && i.snippet.title) || 'YouTube video',
    channel: (i.snippet && i.snippet.channelTitle) || '',
    thumb: (i.snippet && i.snippet.thumbnails && (i.snippet.thumbnails.medium || i.snippet.thumbnails.default) || {}).url || '',
  }));

const slimVideos = j =>
  (j.items || []).map(v => ({
    id: v.id,
    title: (v.snippet && v.snippet.title) || 'YouTube video',
    channel: (v.snippet && v.snippet.channelTitle) || '',
    thumb: (v.snippet && v.snippet.thumbnails && (v.snippet.thumbnails.medium || v.snippet.thumbnails.default) || {}).url || '',
    dur: isoSecs(v.contentDetails && v.contentDetails.duration),
  }));

/* ---- Guards: per-IP rate limit + daily YouTube quota budget ----
 * (best-effort, in-memory per isolate — plenty for a personal app) */
const hits = new Map();
function rateOk(ip) {
  const now = Date.now(), windowMs = 60000, max = 30;
  const arr = (hits.get(ip) || []).filter(t => now - t < windowMs);
  arr.push(now);
  if (hits.size > 5000) hits.clear();
  hits.set(ip, arr);
  return arr.length <= max;
}
let quotaDay = '', quotaUsed = 0;
const QUOTA_BUDGET = 9000; // of the 10,000 units/day YouTube gives for free
function quotaOk(cost) {
  const day = new Date().toISOString().slice(0, 10);
  if (day !== quotaDay) { quotaDay = day; quotaUsed = 0; }
  if (quotaUsed + cost > QUOTA_BUDGET) return false;
  quotaUsed += cost;
  return true;
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    const cors = {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405, cors);
    if (!env.YT_API_KEY) return json({ error: 'Server misconfigured: YT_API_KEY secret missing' }, 500, cors);

    const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
    if (!rateOk(ip)) return json({ error: 'Too many requests — slow down a little.' }, 429, cors);

    /* ---- Trending: cached for an hour, costs ~1 API unit per region/hour ---- */
    if (url.pathname === '/api/yt/trending') {
      const cache = caches.default;
      const cacheKey = new Request(url.origin + '/api/yt/trending');
      let resp = await cache.match(cacheKey);
      if (!resp) {
        if (!quotaOk(1)) return json({ error: 'Daily YouTube quota reached — try again tomorrow.' }, 429, cors);
        const sp = new URLSearchParams({
          part: 'snippet,contentDetails', chart: 'mostPopular',
          videoCategoryId: '10', regionCode: 'IN', maxResults: '12',
          key: env.YT_API_KEY,
        });
        const yt = await fetch('https://www.googleapis.com/youtube/v3/videos?' + sp.toString());
        if (!yt.ok) return json({ error: 'YouTube error ' + yt.status }, 502, cors);
        resp = json(slimVideos(await yt.json()), 200, { ...cors, 'Cache-Control': 'public, max-age=3600' });
        ctx.waitUntil(cache.put(cacheKey, resp.clone()));
      }
      return resp;
    }

    /* ---- Search: 100 API units each, guarded by rate limit + daily budget ---- */
    if (url.pathname === '/api/yt/search') {
      const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
      if (!q) return json({ error: 'Missing ?q=' }, 400, cors);
      if (!quotaOk(100)) return json({ error: 'Daily YouTube quota reached — try again tomorrow.' }, 429, cors);
      const sp = new URLSearchParams({
        part: 'snippet', type: 'video', videoCategoryId: '10',
        maxResults: '12', q, key: env.YT_API_KEY,
      });
      const yt = await fetch('https://www.googleapis.com/youtube/v3/search?' + sp.toString());
      if (!yt.ok) return json({ error: 'YouTube error ' + yt.status }, 502, cors);
      return json(slimSearch(await yt.json()), 200, cors);
    }

    /* ---- Status page: friendly landing at /, so the bare URL isn't a bare 404 ---- */
    if (url.pathname === '/') {
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tunebox backend</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#0d1117;color:#e6edf3;font-family:system-ui,-apple-system,sans-serif}
  .card{max-width:520px;padding:40px 32px;text-align:center}
  .dot{display:inline-block;width:12px;height:12px;border-radius:50%;background:#3fb950;
    box-shadow:0 0 12px #3fb950;margin-right:8px;vertical-align:1px}
  h1{font-size:24px;margin:0 0 8px}
  p{color:#8b949e;line-height:1.6;margin:8px 0}
  code{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:2px 8px;
    font-size:13px;color:#79c0ff}
  .eps{margin-top:20px;text-align:left;display:inline-block}
  .eps div{margin:6px 0}
  a{color:#58a6ff}
</style></head><body><div class="card">
  <h1><span class="dot"></span>Tunebox backend is running</h1>
  <p>This is the API server behind the <a href="https://anological.github.io/tunebox/">Tunebox</a>
  music app. It keeps the YouTube API key on the server — there is no webpage here,
  just these endpoints:</p>
  <div class="eps">
    <div><code>GET /api/yt/search?q=...</code> — YouTube music search</div>
    <div><code>GET /api/yt/trending</code> — trending music videos (cached 1h)</div>
  </div>
  <p>Open the app to use it.</p>
</div></body></html>`;
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...cors } });
    }

    return json({ error: 'Not found. Try /api/yt/search?q=... or /api/yt/trending' }, 404, cors);
  },
};
