# Tunebox backend — deploy in ~3 minutes (free)

The backend hides your YouTube API key on a server, so it never appears in the
app's JavaScript. It runs on Cloudflare Workers (free tier, no credit card).

## 1. Create the Worker

1. Go to https://dash.cloudflare.com and sign up / log in (free).
2. Left menu → **Workers & Pages** → **Create** → **Create Worker** → **Deploy**
   (you'll get a starter worker; that's fine).
3. Click **Edit code**, delete everything in the editor, and paste the entire
   contents of `worker.js` from this folder. Click **Deploy** (top right).

## 2. Add your YouTube API key as a secret

1. In the worker's page: **Settings** tab → **Variables and Secrets** →
   **Add** (under Secrets).
2. Name: `YT_API_KEY`
   Value: your YouTube Data API v3 key (the one from Google Cloud Console).
3. Save. (Redeploy if it asks — the secret is never shown again, even to you.)

## 3. Connect Tunebox to it

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
- Guards: 30 requests/minute per visitor, plus a daily YouTube quota budget
  (search costs 100 units; the free daily allowance is 10,000)
- Only answers Tunebox's own site (and localhost for development)

## Growing it later

This worker is the home for anything that needs a secret or a server:
per-user sync, shared playlists, or a download proxy. Add a route, redeploy —
no server to maintain.
