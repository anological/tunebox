# Tunebox — offline music player

A Spotify-style web music player with your own branding. 100% offline-capable:
just open `index.html` in a browser. No build step, no server, no internet needed.

## Run it

- **Easiest:** double-click `index.html`.
- **Or:** `cd tunewave && python3 -m http.server 8000`, then open http://127.0.0.1:8000

## What's inside

- `index.html` — page structure
- `styles.css` — dark theme styling
- `app.js` — all player logic (playlists, search, queue, uploads, persistence)
- `assets/audio/` — 6 original demo tracks (procedurally composed, royalty-free)

## Features

- Home / Search / Your Library sidebar, like the big streaming apps
- Play, pause, next/previous, seek, shuffle, repeat (all / one), volume, mute
- Create playlists, like songs (♥), double-click a track to add it to a playlist
- Live search across titles, artists and albums + browse-by-genre cards
- **Add music** button: import your own MP3/WAV files — they're stored in the
  browser (IndexedDB) so they survive reloads, still fully offline
- Playlists and likes persist via localStorage
- Spacebar toggles play/pause

## Spotify playback (optional)

Tunebox can play the full Spotify catalog using Spotify's official
Web Playback SDK — no backend needed. You need a **Spotify Premium**
account (Spotify's rule, not ours).

The Tunebox Spotify app is already created and pre-configured
(Client ID `6657530664d14112bb13e4276d36e893`).

1. Serve the folder over HTTP: `cd tunewave && python3 -m http.server 8000`
2. Open **http://127.0.0.1:8000** (Spotify doesn't accept the `localhost` name —
   use the `127.0.0.1` address).
3. In Tunebox, open **Spotify** in the sidebar and click **Connect Spotify**,
   then log in with your Spotify account.

The app handles login with PKCE (no server), stores tokens in your browser,
and refreshes them silently.

## Free music (no account needed)

Open **Free Music** in the sidebar: two free sources, no login, no
payment — press play and it just works.

- **Audius** — trending tracks, genre browsing and search from
  independent artists.
- **Archive** — the Internet Archive's live concerts and classic
  recordings; search the whole audio collection or browse popular
  shows, then play full track lists.

## Make it yours

- **Rename the brand:** find-and-replace `Tunebox` in `index.html` and `app.js`,
  and swap the logo SVG in `index.html`.
- **Change the accent colour:** edit `--accent` in `styles.css`
  (currently violet `#8b5cf6`).
- **Add your own tracks permanently:** drop audio files into `assets/audio/`
  and add entries to the `BUILTIN` array at the top of `app.js`
  (id, title, artist, album, src, duration in seconds, hue, tags).

## Regenerating the demo tracks

The demo songs were composed by a script: `gen_tracks.py`
(kept next to this folder in the workspace). Run it to rebuild the WAVs.
