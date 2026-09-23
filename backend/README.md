# Tunebox backend — deploy in ~3 minutes (free)

The backend hides your YouTube API key on a server, so it never appears in the
app's JavaScript. It runs on Cloudflare Workers (free tier, no credit card).

## 1. Create the Worker

1. Go to https://dash.cloudflare.com and sign up / log in (free).
2. Left menu → **Workers & Pages** → **Create** → **Create Worker** → **Deploy**
   (you'll get a starter worker; that's fine).
3. Click **Edit code**, delete everything in the editor, and paste the entire
   contents of `worker.js` from this folder. Click **Deploy** (top right).

## 2. Add your secrets and variables

1. In the worker's page: **Settings** tab → **Variables and Secrets**.
2. Under **Secrets**, add:
   - Name: `YT_API_KEY` — Value: your YouTube Data API v3 key.
3. Under **Variables** (plain text), add:
   - Name: `GOOGLE_CLIENT_ID` — Value: your Google OAuth client ID
     (Google Cloud Console → APIs & Services → Credentials → OAuth client ID,
     type Web application, authorized JavaScript origin
     `https://anological.github.io`).

## 3. Add the D1 database (for accounts + sync)

1. Cloudflare dashboard → **Storage & Databases** → **D1 SQL database** →
   **Create** → name it `tunebox-db`.
2. Open the `tunebox-db` database → **Console** tab → run this schema:
   ```sql
   CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, name TEXT, picture TEXT, created_at INTEGER, updated_at INTEGER);
   CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER, expires_at INTEGER);
   CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
   CREATE TABLE IF NOT EXISTS sync_state (user_id TEXT PRIMARY KEY, playlists_json TEXT NOT NULL DEFAULT '[]', liked_json TEXT NOT NULL DEFAULT '[]', history_json TEXT NOT NULL DEFAULT '[]', updated_at INTEGER);
   ```
3. Back on the worker: **Settings** → **Bindings** → **Add binding** →
   **D1 database** → variable name `DB` → select `tunebox-db` → save
   (redeploy if it asks).

## 4. Connect Tunebox to it

1. Copy your worker's URL — it looks like
   `https://tunebox-api.<your-name>.workers.dev`
   (Workers & Pages → your worker → **Visit** copies it).
2. Open Tunebox → **Free Music** → **YouTube** tab.
3. Paste the URL into **Backend URL** and hit **Save**.
4. That's it — YouTube search and the home-page trending row now run through
   your backend. The key is nowhere in the app anymore.

## 4. (Recommended) Retire the old exposed key

The previous key was visible in the app's public source. Once the backend
works, create a fresh key in Google Cloud Console (Credentials → Create
Credentials → API key, restrict to YouTube Data API v3), put the new key in
the worker secret, and delete the old one.

## What the backend does

- `GET /api/yt/search?q=...` — YouTube music-video search (slim JSON back)
- `GET /api/yt/trending` — most-popular music videos, cached 1 hour
- `POST /api/auth/google` · `GET /api/auth/me` · `POST /api/auth/logout` —
  Google Sign-In (ID token verified server-side, session in D1, HttpOnly cookie)
- `GET /api/sync` · `POST /api/sync` — per-user cloud library
  (playlists, liked songs, listening history; uploaded audio stays on-device)
- Guards: 30 requests/minute per visitor, plus a daily YouTube quota budget
  (search costs 100 units; the free daily allowance is 10,000)
- Only answers Tunebox's own site (and localhost for development)

## Growing it later

This worker is the home for anything that needs a secret or a server:
per-user sync, shared playlists, or a download proxy. Add a route, redeploy —
no server to maintain.
