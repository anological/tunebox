/* Tunebox backend — Cloudflare Worker (free tier).
 *
 * Two jobs:
 *  1. YouTube proxy: keeps the YouTube Data API v3 key on the server.
 *       GET /api/yt/search?q=...      → YouTube search.list (music videos)
 *       GET /api/yt/trending          → YouTube most-popular music videos (cached 1h)
 *  2. Accounts + cloud sync (Google Sign-In, D1 database):
 *       POST /api/auth/google  {credential} → verifies the Google ID token,
 *                                              creates a session cookie
 *       GET  /api/auth/me      → current user or 401
 *       POST /api/auth/logout  → destroys the session
 *       GET  /api/sync         → {playlists, liked, history} for this user
 *       POST /api/sync        → saves {playlists, liked, history}
 *
 * Setup: paste this file into the tunebox-api Worker, then
 *   - add secret YT_API_KEY (YouTube Data API v3 key),
 *   - set variable GOOGLE_CLIENT_ID to your Google OAuth client ID,
 *   - bind a D1 database as variable DB (see backend/README.md).
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

const corsFor = req => {
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400',
  };
};

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
function rateOk(ip, max = 30) {
  const now = Date.now(), windowMs = 60000;
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

/* ---------------- Google Sign-In: verify ID tokens ---------------- */
const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
let certsCache = null, certsExp = 0;
async function googleCerts() {
  if (certsCache && Date.now() < certsExp) return certsCache;
  const r = await fetch(GOOGLE_CERTS_URL, { cf: { cacheTtl: 3600 } });
  if (!r.ok) throw new Error('Could not fetch Google certs');
  certsCache = await r.json();
  certsExp = Date.now() + 3600_000;
  return certsCache;
}
function b64urlToBytes(s) {
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
/* Verifies a Google Identity Services ID token and returns its payload
 * ({sub, email, name, picture}) — throws on anything suspicious. */
async function verifyGoogleToken(credential, clientId) {
  const parts = String(credential || '').split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  const [h, p, sig] = parts;
  let header, payload;
  try {
    header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
    payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
  } catch (e) { throw new Error('Malformed token'); }
  if (header.alg !== 'RS256') throw new Error('Unexpected token algorithm');
  const certs = await googleCerts();
  const jwk = (certs.keys || []).find(k => k.kid === header.kid);
  if (!jwk) throw new Error('Unknown signing key');
  const key = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key, b64urlToBytes(sig), new TextEncoder().encode(h + '.' + p));
  if (!valid) throw new Error('Bad token signature');
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== clientId) throw new Error('Token was not issued for this app');
  if (typeof payload.exp !== 'number' || payload.exp < now) throw new Error('Token expired');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss))
    throw new Error('Wrong token issuer');
  if (!payload.sub) throw new Error('Token has no subject');
  return payload;
}

/* ---------------- Sessions (D1) ---------------- */
const SESSION_DAYS = 30;
async function sha256hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function newToken() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}
// Sessions: the frontend sends the token as `Authorization: Bearer <token>`.
// (Cross-site cookies are blocked by some browsers, so we don't rely on cookies.)
function bearerToken(req) {
  const h = req.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}
async function sessionUser(req, env) {
  const token = bearerToken(req);
  if (!token) return null;
  const row = await env.DB.prepare(
    'SELECT user_id, expires_at FROM sessions WHERE token_hash = ?')
    .bind(await sha256hex(token)).first();
  if (!row || row.expires_at < Date.now()) return null;
  return env.DB.prepare('SELECT id, email, name, picture FROM users WHERE id = ?')
    .bind(row.user_id).first();
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const cors = corsFor(req);
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
    if (!rateOk(ip)) return json({ error: 'Too many requests — slow down a little.' }, 429, cors);

    /* ================= Accounts & sync ================= */
    if (url.pathname === '/api/auth/google' && req.method === 'POST') {
      if (!rateOk(ip + ':auth', 10))
        return json({ error: 'Too many sign-in attempts — try again in a minute.' }, 429, cors);
      if (!env.DB) return json({ error: 'Server misconfigured: D1 database not bound' }, 500, cors);
      if (!env.GOOGLE_CLIENT_ID)
        return json({ error: 'Server misconfigured: GOOGLE_CLIENT_ID missing' }, 500, cors);
      let body;
      try { body = await req.json(); } catch (e) { return json({ error: 'Bad request' }, 400, cors); }
      let claims;
      try { claims = await verifyGoogleToken(body.credential, env.GOOGLE_CLIENT_ID); }
      catch (e) { return json({ error: 'Sign-in failed: ' + e.message }, 401, cors); }
      const now = Date.now();
      await env.DB.prepare(
        `INSERT INTO users (id, email, name, picture, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET email=excluded.email, name=excluded.name,
           picture=excluded.picture, updated_at=excluded.updated_at`)
        .bind(claims.sub, claims.email || '', claims.name || '', claims.picture || '', now, now).run();
      const token = newToken();
      await env.DB.prepare(
        'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
        .bind(await sha256hex(token), claims.sub, now, now + SESSION_DAYS * 86400_000).run();
      const user = await env.DB.prepare('SELECT id, email, name, picture FROM users WHERE id = ?')
        .bind(claims.sub).first();
      return json({ user, token }, 200, cors);
    }

    if (url.pathname === '/api/auth/me' && req.method === 'GET') {
      if (!env.DB) return json({ error: 'Server misconfigured: D1 database not bound' }, 500, cors);
      const user = await sessionUser(req, env);
      if (!user) return json({ error: 'Not signed in' }, 401, cors);
      return json({ user }, 200, cors);
    }

    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      if (!env.DB) return json({ error: 'Server misconfigured: D1 database not bound' }, 500, cors);
      const token = bearerToken(req);
      if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?')
        .bind(await sha256hex(token)).run();
      return json({ ok: true }, 200, cors);
    }

    if (url.pathname === '/api/sync' && (req.method === 'GET' || req.method === 'POST')) {
      if (!env.DB) return json({ error: 'Server misconfigured: D1 database not bound' }, 500, cors);
      const user = await sessionUser(req, env);
      if (!user) return json({ error: 'Not signed in' }, 401, cors);
      if (req.method === 'GET') {
        const row = await env.DB.prepare(
          'SELECT playlists_json, liked_json, history_json, updated_at FROM sync_state WHERE user_id = ?')
          .bind(user.id).first();
        return json({
          playlists: row ? JSON.parse(row.playlists_json) : [],
          liked: row ? JSON.parse(row.liked_json) : [],
          history: row ? JSON.parse(row.history_json) : [],
          updated_at: row ? row.updated_at : 0,
        }, 200, cors);
      }
      let body;
      try { body = await req.json(); } catch (e) { return json({ error: 'Bad request' }, 400, cors); }
      const playlists = Array.isArray(body.playlists) ? body.playlists : [];
      const liked = Array.isArray(body.liked) ? body.liked : [];
      const history = Array.isArray(body.history) ? body.history : [];
      // sanity caps: playlists ≤ 200, each ≤ 2000 tracks, ids are short strings
      if (playlists.length > 200 || liked.length > 20000 || history.length > 2000)
        return json({ error: 'Sync payload too large' }, 413, cors);
      const cleanPlaylists = playlists.slice(0, 200).map(p => ({
        id: String(p.id || '').slice(0, 64),
        name: String(p.name || 'Playlist').slice(0, 80),
        desc: String(p.desc || '').slice(0, 200),
        hue: Math.max(0, Math.min(360, +p.hue || 0)),
        trackIds: (Array.isArray(p.trackIds) ? p.trackIds : []).slice(0, 2000).map(String).map(s => s.slice(0, 80)),
        updatedAt: Math.max(0, +p.updatedAt || 0),
      }));
      const cleanIds = arr => [...new Set(arr.map(String).map(s => s.slice(0, 80)))];
      await env.DB.prepare(
        `INSERT INTO sync_state (user_id, playlists_json, liked_json, history_json, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET playlists_json=excluded.playlists_json,
           liked_json=excluded.liked_json, history_json=excluded.history_json,
           updated_at=excluded.updated_at`)
        .bind(user.id, JSON.stringify(cleanPlaylists), JSON.stringify(cleanIds(liked).slice(0, 20000)),
          JSON.stringify(cleanIds(history).slice(-2000)), Date.now()).run();
      return json({ ok: true }, 200, cors);
    }

    /* ================= YouTube proxy (unchanged) ================= */
    if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405, cors);
    if (!env.YT_API_KEY) return json({ error: 'Server misconfigured: YT_API_KEY secret missing' }, 500, cors);

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

    if (url.pathname === '/api/yt/related') {
      const videoId = (url.searchParams.get('videoId') || '').trim().slice(0, 20);
      if (!videoId) return json({ error: 'Missing ?videoId=' }, 400, cors);
      if (!quotaOk(100)) return json({ error: 'Daily YouTube quota reached — try again tomorrow.' }, 429, cors);
      const sp = new URLSearchParams({
        part: 'snippet', type: 'video', videoCategoryId: '10',
        maxResults: '10', relatedToVideoId: videoId, key: env.YT_API_KEY,
      });
      const yt = await fetch('https://www.googleapis.com/youtube/v3/search?' + sp.toString());
      if (!yt.ok) return json({ error: 'YouTube error ' + yt.status }, 502, cors);
      return json(slimSearch(await yt.json()), 200, cors);
    }

    /* ---- Status page ---- */
    if (url.pathname === '/') {
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tunebox backend</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#0d1117;color:#e6edf3;font-family:system-ui,-apple-system,sans-serif}
  .card{max-width:560px;padding:40px 32px;text-align:center}
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
  music app. It keeps the YouTube API key on the server and stores signed-in
  users' libraries — there is no webpage here, just these endpoints:</p>
  <div class="eps">
    <div><code>GET /api/yt/search?q=...</code> — YouTube music search</div>
    <div><code>GET /api/yt/trending</code> — trending music videos (cached 1h)</div>
    <div><code>POST /api/auth/google</code> · <code>GET /api/auth/me</code> · <code>POST /api/auth/logout</code> — accounts</div>
    <div><code>GET /api/sync</code> · <code>POST /api/sync</code> — cloud library sync</div>
  </div>
  <p>Open the app to use it.</p>
</div></body></html>`;
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...cors } });
    }

    return json({ error: 'Not found. Try /api/yt/search?q=... or /api/yt/trending' }, 404, cors);
  },
};
