/* Tunebox - offline music player. All demo tracks are original compositions. */
'use strict';

/* ---------------- Data ---------------- */
const BUILTIN = [
  { id: 't1', title: 'Midnight Drive',   artist: 'Neon Coast',    album: 'Afterglow',   src: 'assets/audio/track1.wav', image: 'assets/covers/t1.jpg', duration: 19.2, hue: 265, tags: ['electronic', 'chill'] },
  { id: 't2', title: 'Solar Bloom',      artist: 'Aurora Fields', album: 'Daybreak',    src: 'assets/audio/track2.wav', image: 'assets/covers/t2.jpg', duration: 16.0, hue: 45,  tags: ['pop', 'chill'] },
  { id: 't3', title: 'Static Dreams',    artist: 'Velvet Circuit',album: 'Neon Static', src: 'assets/audio/track3.wav', image: 'assets/covers/t3.jpg', duration: 15.0, hue: 200, tags: ['electronic', 'workout'] },
  { id: 't4', title: 'Tidal',             artist: 'Blue Meridian', album: 'Drift',       src: 'assets/audio/track4.wav', image: 'assets/covers/t4.jpg', duration: 20.9, hue: 190, tags: ['ambient', 'chill'] },
  { id: 't5', title: 'Paper Satellites', artist: 'The Orbiters',  album: 'Low Orbit',   src: 'assets/audio/track5.wav', image: 'assets/covers/t5.jpg', duration: 17.5, hue: 280, tags: ['rock', 'indie'] },
  { id: 't6', title: 'Amber Skies',       artist: 'Field Notes',   album: 'Harvest',     src: 'assets/audio/track6.wav', image: 'assets/covers/t6.jpg', duration: 18.3, hue: 25,  tags: ['indie', 'chill'] },
];
const CATEGORIES = [
  { name: 'Pop', hue: 330, q: 'pop' }, { name: 'Electronic', hue: 210, q: 'electronic' },
  { name: 'Chill', hue: 190, q: 'chill' }, { name: 'Rock', hue: 0, q: 'rock' },
  { name: 'Indie', hue: 280, q: 'indie' }, { name: 'Ambient', hue: 160, q: 'ambient' },
  { name: 'Workout', hue: 30, q: 'workout' },
];

let library = [...BUILTIN];          // all tracks (builtin + uploads)
let playlists = [];                  // {id,name,trackIds,desc,builtin}
let liked = new Set();
let queue = [], qi = -1;
let shuffle = false, repeatMode = 'off';
let currentView = { name: 'home' };
let history = [], hIndex = -1;

/* ---------------- Persistence ---------------- */
const LS_PL = 'tunebox.playlists', LS_LIKED = 'tunebox.liked', LS_LISTEN = 'tunebox.listens';
/* Listening history: what you actually play — the basis of your taste profile.
   Local only, newest last, capped at 300. */
let listenLog = [];
try { listenLog = JSON.parse(localStorage.getItem(LS_LISTEN) || '[]'); } catch (e) { listenLog = []; }
function recordListen(id) {
  if (!id || listenLog[listenLog.length - 1] === id) return;
  listenLog.push(id);
  if (listenLog.length > 300) listenLog = listenLog.slice(-300);
  try { localStorage.setItem(LS_LISTEN, JSON.stringify(listenLog)); } catch (e) { /* private mode */ }
  scheduleSync();
}
function saveLS() {
  localStorage.setItem(LS_PL, JSON.stringify(playlists.filter(p => !p.builtin)));
  localStorage.setItem(LS_LIKED, JSON.stringify([...liked]));
  try { localStorage.setItem(LS_DELETED, JSON.stringify(deletedPls)); } catch (e) { /* private mode */ }
  scheduleSync();
}
function loadLS() {
  try {
    const pl = JSON.parse(localStorage.getItem(LS_PL) || '[]');
    playlists.push(...pl);
    liked = new Set(JSON.parse(localStorage.getItem(LS_LIKED) || '[]'));
    deletedPls = JSON.parse(localStorage.getItem(LS_DELETED) || '{}') || {};
  } catch (e) { /* fresh start */ }
}
function seedPlaylists() {
  if (!playlists.some(p => p.id === 'pl-top'))
    playlists.unshift({ id: 'pl-top', name: 'Top Hits 2026', desc: 'The biggest tracks right now.', trackIds: ['t1','t3','t2','t5'], builtin: true, hue: 320 });
  if (!playlists.some(p => p.id === 'pl-chill'))
    playlists.unshift({ id: 'pl-chill', name: 'Chill Vibes', desc: 'Easy listening for slow days.', trackIds: ['t4','t2','t6','t1'], builtin: true, hue: 190 });
}

/* Uploaded audio blobs live in IndexedDB so they survive reloads */
let idb = null;
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('tunebox-db', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => { idb = r.result; res(); };
    r.onerror = () => rej(r.error);
  });
}
function idbPut(id, blob) {
  return new Promise((res, rej) => {
    const tx = idb.transaction('files', 'readwrite').objectStore('files').put(blob, id);
    tx.onsuccess = res; tx.onerror = () => rej(tx.error);
  });
}
function idbAll() {
  return new Promise((res, rej) => {
    const out = [];
    const cur = idb.transaction('files', 'readonly').objectStore('files').openCursor();
    cur.onsuccess = () => { const c = cur.result; if (c) { out.push([c.key, c.value]); c.continue(); } else res(out); };
    cur.onerror = () => rej(cur.error);
  });
}

/* ---------------- Helpers ---------------- */
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = s => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const trackById = id => library.find(t => t.id === id) || spotifyTrackCache[id] || audiusTrackCache[id] || archiveTrackCache[id] || albumTrackCache[id];

/* ---------------- Featured albums (curated; play free via YouTube audio) ---------------- */
const albumTrackCache = {};
const FEATURED_ALBUMS = [
  {
    id: 'designerr', title: 'DESIGNERR', artist: 'Jokhay & Umair', year: '2026', label: 'Mass Appeal',
    cover: 'assets/covers/designerr.jpg',
    blurb: 'The 2026 producer album from Jokhay & Umair — 12 tracks with Talha Anjum, Talhah Yunus, JJ47, Asim Azhar, Faris Shafi, Maanu, Afusic, Ghostface Killah, Benny The Butcher and more.',
    tracks: [
      { title: 'DESIGNERR', artist: 'Jokhay, Umair, CGF', ytId: 'xOEFYt_3LaU', dur: 119 },
      { title: 'GOD KNOWS', artist: 'Jokhay, Umair, Talha Anjum, Talhah Yunus, JJ47', ytId: '_CVxGDf76OA', dur: 216 },
      { title: 'BACKSEAT', artist: 'Jokhay, Umair, JANI, Jevin Gill, Talhah Yunus', ytId: 'X6tk8cZdjK8', dur: 209 },
      { title: 'READY OR NOT', artist: 'Jokhay, Umair, Talha Anjum, Benny The Butcher', ytId: 'IGX3HRUOsQo', dur: 237 },
      { title: 'MAFIA', artist: 'Jokhay, Umair, Talha Anjum, Rap Demon, Talhah Yunus', ytId: 'uZ0PfEoi5BE', dur: 243 },
      { title: 'WAY 2 BLESSED', artist: 'Jokhay, Umair, Shareh, Keeya Keys, JJ47', ytId: 'ZefD4R5B3Wk', dur: 218 },
      { title: 'GANGLAND', artist: 'Jokhay, Umair, Talha Anjum, JJ47, Ghostface Killah, Talhah Yunus', ytId: 'E5ccP8grfGY', dur: 251 },
      { title: 'MISS ME?', artist: 'Jokhay, Umair, Asim Azhar, Faris Shafi', ytId: 'mDl16BBYMRo', dur: 184 },
      { title: 'CLOSE 2 U', artist: 'Jokhay, Umair, Izzchughtai, Nehaal Naseem', ytId: 'L8As2megrzY', dur: 208 },
      { title: 'DAAGH', artist: 'Jokhay, Umair, Maanu, Afusic', ytId: 'Kf0xzavQhNY', dur: 207 },
      { title: 'REMEDY', artist: 'Jokhay, Umair, JANI, Nadine El Roubi', ytId: 'N5Lp0frXdKQ', dur: 204 },
      { title: 'HOME', artist: 'Jokhay, Umair, Talha Anjum, Talhah Yunus', ytId: 'ZWG9iXnrDfI', dur: 277 },
    ]
  }
];
function albumTracks(a) {
  return a.tracks.map((tr, i) => {
    const id = `alb-${a.id}-${i}`;
    if (!albumTrackCache[id]) albumTrackCache[id] = {
      id, title: tr.title, artist: tr.artist, album: a.title,
      source: 'yt-audio', ytId: tr.ytId, duration: tr.dur,
      image: `https://i.ytimg.com/vi/${tr.ytId}/hqdefault.jpg`,
      hue: 222, tags: ['hip-hop']
    };
    return albumTrackCache[id];
  });
}
function playAlbum(a, idx) {
  const ids = albumTracks(a).map(t => t.id);
  setQueue(ids, idx || 0); playCurrent();
}
const coverStyle = t => `background: linear-gradient(135deg, hsl(${t.hue},70%,45%), hsl(${(t.hue + 50) % 360},75%,28%))`;
/* Generated poster artwork: a real image so no track ever shows a blank hole.
   Stable per-name color, big initial letter + music notes, SVG data URI. */
const hueFor = s => { let h = 7; s = String(s == null ? '' : s); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; };
const posterURL = (name, hue) => {
  hue = ((hue == null ? hueFor(name) : hue) % 360 + 360) % 360;
  const h2 = (hue + 50) % 360;
  const ch = esc((String(name || '').trim().charAt(0) || '♪').toUpperCase());
  const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'>" +
    "<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>" +
    "<stop offset='0' stop-color='hsl(" + hue + ",72%,46%)'/>" +
    "<stop offset='1' stop-color='hsl(" + h2 + ",76%,26%)'/></linearGradient></defs>" +
    "<rect width='300' height='300' fill='url(#g)'/>" +
    "<circle cx='150' cy='126' r='88' fill='rgba(255,255,255,0.13)'/>" +
    "<text x='150' y='170' font-size='92' text-anchor='middle' fill='rgba(255,255,255,0.95)' font-family='Arial,Helvetica,sans-serif'>" + ch + "</text>" +
    "<text x='150' y='262' font-size='38' text-anchor='middle' fill='rgba(255,255,255,0.6)' font-family='Arial,Helvetica,sans-serif'>&#9834; &#9835;</text></svg>";
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg).replace(/'/g, '%27');
};
const posterImg = (name, hue, cls) => `<img class="${cls}" src="${posterURL(name, hue)}" alt="" loading="lazy">`;
/* Universal cover fallback: any <img> carrying data-poster swaps to the generated
   poster if its real source fails to load — a poster is never blank or broken. */
document.addEventListener('error', e => {
  const el = e.target;
  if (el && el.tagName === 'IMG' && el.dataset && el.dataset.poster && !el.dataset.fbk) {
    el.dataset.fbk = '1';
    el.src = el.dataset.poster;
  }
}, true);
/* Playlist poster: 2x2 collage of the first tracks' artwork, with the generated
   poster as fallback behind every cell so no cell is ever blank. */
const plPosterHTML = (ids, hue, cls, icon) => {
  const tracks = (ids || []).map(trackById).filter(Boolean).slice(0, 4);
  if (!tracks.length)
    return `<div class="${cls}" style="background:linear-gradient(135deg,hsl(${hue},70%,45%),hsl(${(hue + 50) % 360},75%,28%))">${icon || '&#9835;'}</div>`;
  const cell = t => {
    const poster = posterURL((t.title || '') + ' ' + (t.artist || ''), t.hue);
    const bg = t.image ? `url('${t.image}'),url("${poster}")` : `url("${poster}")`;
    return `<div class="pl-cell" style="background-image:${bg}"></div>`;
  };
  return `<div class="${cls} pl-collage n${tracks.length}">${tracks.map(cell).join('')}</div>`;
};
const coverHTML = (t, cls) => {
  const poster = posterURL((t.title || '') + ' ' + (t.artist || ''), t.hue);
  const bg = t.image
    ? `background-image:url('${t.image}'),url("${poster}");` /* poster shows through if t.image 404s */
    : `background-image:url("${poster}");`;
  return `<div class="${cls}" style="${bg}background-size:cover;background-position:center"></div>`;
};
const totalDur = ids => ids.reduce((a, id) => a + (trackById(id)?.duration || 0), 0);

/* Global toast: one feedback bubble for the whole app (playlist actions,
   downloads, sync, errors). Reuses the #sp-toast element + styles. */
let _toastEl = null, _toastT = null;
function toast(msg, sticky) {
  if (!_toastEl) {
    _toastEl = document.getElementById('sp-toast');
    if (!_toastEl) { _toastEl = document.createElement('div'); _toastEl.id = 'sp-toast'; document.body.appendChild(_toastEl); }
  }
  clearTimeout(_toastT);
  if (!msg) { _toastEl.classList.remove('show'); return; }
  _toastEl.textContent = msg;
  _toastEl.classList.add('show');
  if (!sticky) _toastT = setTimeout(() => _toastEl.classList.remove('show'), 2600);
}

/* Modal dialog: styled replacement for prompt()/confirm(). */
function openModal(title, bodyHTML, buttons) {
  const scrim = document.getElementById('modal-scrim');
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHTML;
  const acts = document.getElementById('modal-actions');
  acts.innerHTML = '';
  (buttons || [{ label: 'Close' }]).forEach(b => {
    const btn = document.createElement('button');
    btn.textContent = b.label;
    btn.className = b.primary ? 'sp-btn' : 'ghost-btn';
    btn.addEventListener('click', () => (b.onClick || closeModal)(closeModal));
    acts.appendChild(btn);
  });
  scrim.hidden = false;
}
function closeModal() { document.getElementById('modal-scrim').hidden = true; }

/* Skeleton shimmer shown while remote sections load — no more blank flashes. */
const skelRow = (n, title) => `
  <div class="section-title" style="font-size:17px">${title}</div>
  <div class="skel-row">${('<div class="skel-thumb"><div class="skel skel-cover"></div>' +
    '<div class="skel skel-line"></div><div class="skel skel-line short"></div></div>').repeat(n)}</div>`;
/* Skeleton shimmer matching the track-table layout. */
const skelTracks = n => `<table class="track-table"><tbody>${(
  '<tr><td colspan="5"><div style="display:flex;gap:12px;align-items:center">' +
  '<div class="skel" style="width:40px;height:40px;flex-shrink:0"></div>' +
  '<div style="flex:1"><div class="skel skel-line" style="width:42%"></div>' +
  '<div class="skel skel-line short" style="width:24%;margin-bottom:0"></div></div>' +
  '<div class="skel skel-line" style="width:44px;margin-bottom:0"></div></div></td></tr>'
).repeat(n)}</tbody></table>`;

/* ---------------- Accounts & cloud sync (Tunebox backend) ----------------
 * Sign in with Google → the backend verifies the ID token, sets a session
 * cookie, and /api/sync keeps playlists, likes and history on your account.
 * Uploaded audio files stay on the device they were added on. */
const GOOGLE_CLIENT_ID = '692454145473-ogvm1sco5ui44i5r49vt6e0oj2o4ghr5.apps.googleusercontent.com';
const LS_DELETED = 'tunebox.deleted';
let tbUser = null;       // {id, email, name, picture} when signed in
let deletedPls = {};     // playlist tombstones {id: timestamp}
let syncing = false, syncDirty = false, syncTimer = null;

async function tbApi(path, opts = {}) {
  const token = localStorage.getItem('tb_session');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(backendUrl() + path, { ...opts, headers });
  if (res.status === 401 && tbUser) {
    tbUser = null; localStorage.removeItem('tb_session'); renderAuthArea();
  }
  return res;
}

function renderAuthArea() {
  const el = document.getElementById('auth-area');
  if (!el) return;
  if (tbUser) {
    const label = tbUser.name || tbUser.email || 'Account';
    const initial = label.trim().charAt(0).toUpperCase();
    el.innerHTML = tbUser.picture
      ? `<button id="avatar-btn" title="${esc(label)}"><img src="${esc(tbUser.picture)}" alt=""></button>`
      : `<button id="avatar-btn" class="avatar" title="${esc(label)}">${esc(initial)}</button>`;
    document.getElementById('avatar-btn').addEventListener('click', openAccountMenu);
  } else {
    el.innerHTML = `<button id="signin-btn">Sign in</button>`;
    document.getElementById('signin-btn').addEventListener('click', openSignIn);
  }
}

function loadGis(cb) {
  if (window.google && window.google.accounts && window.google.accounts.id) return cb();
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.onload = cb;
  s.onerror = () => toast('Could not load Google Sign-In — check your connection');
  document.head.appendChild(s);
}

function openSignIn() {
  openModal('Sign in to Tunebox',
    `<p class="m-note">Your playlists, liked songs and listening history follow your account on any device.</p>
     <div id="gsi-btn"></div>`,
    [{ label: 'Cancel', onClick: close => close() }]);
  loadGis(() => {
    try {
      window.google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: onGoogleCredential });
      window.google.accounts.id.renderButton(document.getElementById('gsi-btn'),
        { theme: 'filled_black', size: 'large', width: 320, text: 'signin_with' });
    } catch (e) { toast('Google Sign-In is not configured yet'); }
  });
}

async function onGoogleCredential(resp) {
  try {
    const r = await tbApi('/api/auth/google', {
      method: 'POST', body: JSON.stringify({ credential: resp.credential }),
    });
    if (!r.ok) throw new Error(((await r.json()).error || 'Sign-in failed').replace(/^Sign-in failed: /, ''));
    const data = await r.json();
    tbUser = data.user;
    if (data.token) localStorage.setItem('tb_session', data.token);
    closeModal(); renderAuthArea();
    toast(`Signed in as ${tbUser.name || tbUser.email}`);
    syncDirty = true; syncNow();
  } catch (e) { toast('Sign-in failed: ' + e.message); }
}

async function signOut() {
  try { await tbApi('/api/auth/logout', { method: 'POST' }); } catch (e) { /* offline */ }
  tbUser = null; localStorage.removeItem('tb_session'); renderAuthArea(); toast('Signed out');
}

function openAccountMenu() {
  if (!tbUser) return;
  openModal('Account',
    `<div class="acct-row">${tbUser.picture ? `<img src="${esc(tbUser.picture)}" class="acct-pic" alt="">` : ''}
       <div><div class="acct-name">${esc(tbUser.name || '')}</div>
       <div class="acct-email">${esc(tbUser.email || '')}</div></div></div>
     <p class="m-note">Playlists, likes and history sync to this account. Uploaded audio stays on this device.</p>`,
    [
      { label: 'Sync now', onClick: close => { syncDirty = true; syncNow(); close(); toast('Syncing…'); } },
      { label: 'Sign out', onClick: async close => { close(); await signOut(); } },
      { label: 'Close', primary: true, onClick: close => close() },
    ]);
}

/* Merge server state with local: per-playlist last-write-wins, likes union,
 * history union (cap 300). Tombstoned playlists stay deleted. */
function mergeCloudState(server) {
  const builtin = playlists.filter(p => p.builtin);
  const byId = {};
  [...playlists.filter(p => !p.builtin), ...((server && server.playlists) || [])].forEach(p => {
    if (!p || !p.id) return;
    const cur = byId[p.id];
    if (!cur || (p.updatedAt || 0) >= (cur.updatedAt || 0)) byId[p.id] = p;
  });
  Object.keys(deletedPls).forEach(id => {
    const t = byId[id];
    if (t && (deletedPls[id] || 0) > (t.updatedAt || 0)) delete byId[id];
  });
  playlists = [...builtin, ...Object.values(byId)];
  ((server && server.liked) || []).forEach(id => liked.add(String(id)));
  const seen = new Set(), merged = [];
  [...listenLog, ...((server && server.history) || [])].forEach(id => {
    id = String(id);
    if (!seen.has(id)) { seen.add(id); merged.push(id); }
  });
  listenLog = merged.slice(-300);
  try {
    localStorage.setItem(LS_PL, JSON.stringify(playlists.filter(p => !p.builtin)));
    localStorage.setItem(LS_LIKED, JSON.stringify([...liked]));
    localStorage.setItem(LS_LISTEN, JSON.stringify(listenLog));
  } catch (e) { /* private mode */ }
  renderSidebar();
  if (typeof currentView !== 'undefined' && currentView && currentView.name) rerender();
}

function scheduleSync() {
  if (!tbUser) return;
  syncDirty = true;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncNow, 2500);
}

async function syncNow() {
  if (!tbUser || syncing || !syncDirty) return;
  syncing = true;
  try {
    const r = await tbApi('/api/sync');
    if (r.ok) mergeCloudState(await r.json());
    else if (r.status === 401) { syncing = false; return; }
    const r2 = await tbApi('/api/sync', {
      method: 'POST',
      body: JSON.stringify({
        playlists: playlists.filter(p => !p.builtin),
        liked: [...liked],
        history: listenLog.slice(-300),
      }),
    });
    if (r2.ok) syncDirty = false;
  } catch (e) { /* offline — local data stays the source of truth, retry on next change */ }
  syncing = false;
}

async function checkSession() {
  renderAuthArea();
  try {
    const r = await tbApi('/api/auth/me');
    if (r.ok) {
      tbUser = (await r.json()).user;
      renderAuthArea();
      syncDirty = true; syncNow();
    }
  } catch (e) { /* backend unreachable — app works fully offline/local */ }
}

/* ---------------- Player ---------------- */
const audio = new Audio();
audio.volume = 0.8;
audio.preload = 'metadata';

function currentTrack() { return qi >= 0 && qi < queue.length ? trackById(queue[qi]) : null; }

function setQueue(ids, start = 0) {
  if (shuffle && ids.length > 1) {
    const first = ids[start];
    const rest = ids.filter((_, i) => i !== start);
    for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[rest[i], rest[j]] = [rest[j], rest[i]]; }
    queue = [first, ...rest]; qi = 0;
  } else { queue = [...ids]; qi = start; }
  renderQueue();
}
function playTrackById(id, contextIds) {
  const ids = contextIds || [id];
  setQueue(ids, Math.max(0, ids.indexOf(id)));
  playCurrent();
}
function isSpotifyTrack(t) { return !!(t && t.source === 'spotify'); }
function currentIsSpotify() { return isSpotifyTrack(currentTrack()); }

async function playCurrent() {
  const t = currentTrack();
  if (!t) return;
  recordListen(t.id);
  if (t.source === 'yt-audio') {
    audio.pause();
    if (spPlayer && spPlaying) spPlayer.pause().catch(() => {});
    spPlaying = false;
    await playYtAudioTrack(t, t.ytId);
  } else if (isSpotifyTrack(t)) {
    audio.pause(); // stop any local playback first
    await loadSpProfile().catch(() => {});
    if (spPremium) {
      try {
        await ensureSpotifyPlayer();
        await waitFor(() => spDeviceId, 12000);
        await spPlayUri(t.spotifyUri);
      } catch (e) {
        spNotice('Could not start Spotify playback: ' + (e.message || e));
      }
    } else {
      await playSpotifyViaYouTube(t); // free accounts: same library, audio via YouTube
    }
  } else {
    stopYt();
    if (spPlayer && spPlaying) spPlayer.pause().catch(() => {});
    spPlaying = false;
    audio.src = t.blobUrl || t.src;
    audio.play().catch(() => {});
  }
  syncPlayerUI();
}
function togglePlay() {
  if (!currentTrack()) { // nothing queued: play liked or everything
    const ids = liked.size ? [...liked] : library.map(t => t.id);
    if (!ids.length) return;
    setQueue(ids, 0); playCurrent(); return;
  }
  if (ytMode && ytPlayer) { if (ytPlaying && !ytStalled) ytPlayer.pauseVideo(); else { disarmYtStall(); ytPlayer.playVideo(); armYtStallWatchdog(); } }
  else if (currentIsSpotify() && spPlayer) (spPlaying ? spPlayer.pause() : spPlayer.resume()).catch(() => {});
  else {
    audio.paused ? audio.play().catch(() => {}) : audio.pause();
  }
  syncPlayerUI();
}
function step(dir) {
  if (!queue.length) return;
  const yt = ytMode && ytPlayer;
  const pos = yt ? ytPlayer.getCurrentTime() : (currentIsSpotify() ? spPosition / 1000 : audio.currentTime);
  if (dir < 0 && pos > 3) {
    if (yt) ytPlayer.seekTo(0, true);
    else if (currentIsSpotify() && spPlayer) spPlayer.seek(0).catch(() => {});
    else audio.currentTime = 0;
    return;
  }
  let n = qi + dir;
  if (n < 0) n = repeatMode === 'all' ? queue.length - 1 : 0;
  if (n >= queue.length) {
    if (repeatMode === 'all') n = 0;
    else { audio.pause(); syncPlayerUI(); return; }
  }
  qi = n; playCurrent();
}
audio.addEventListener('ended', () => {
  if (repeatMode === 'one') { audio.currentTime = 0; audio.play().catch(() => {}); }
  else step(1);
});
audio.addEventListener('timeupdate', () => {
  $('#t-cur').textContent = fmt(audio.currentTime);
  if (audio.duration && !seeking) $('#seek').value = Math.round(audio.currentTime / audio.duration * 1000);
});
audio.addEventListener('loadedmetadata', () => { $('#t-dur').textContent = fmt(audio.duration); });
audio.addEventListener('play', syncPlayBtn);
audio.addEventListener('pause', syncPlayBtn);
audio.addEventListener('error', () => step(1));

let seeking = false;
function isPlaying() { const t = currentTrack(); if (!t) return false; if (ytMode) return ytPlaying; return t.source === 'spotify' ? spPlaying : !audio.paused; }
function syncPlayBtn() { const p = isPlaying(); $('#play').innerHTML = p ? '&#10073;&#10073;' : '&#9654;'; $('#play').title = p ? 'Pause' : 'Play'; $('#play').setAttribute('aria-label', p ? 'Pause' : 'Play'); }
function syncPlayerUI() {
  const t = currentTrack();
  syncPlayBtn();
  if (!t) return;
  const poster = posterURL((t.title || '') + ' ' + (t.artist || ''), t.hue);
  const covCss = t.image
    ? `background-image:url("${t.image}"),url("${poster}");background-size:cover;background-position:center`
    : `background-image:url("${poster}");background-size:cover;background-position:center`;
  $('#pb-cover').style.cssText = covCss;
  $('#pb-title').textContent = t.title;
  $('#pb-artist').textContent = t.artist;
  $('#t-dur').textContent = fmt(t.duration || audio.duration);
  const likeBtn = $('#pb-like');
  likeBtn.classList.toggle('liked', liked.has(t.id));
  likeBtn.innerHTML = liked.has(t.id) ? '&#9829;' : '&#9825;';
  $('#nowplaying').hidden = false;
  $('#np-cover').style.cssText = covCss;
  $('#np-title').textContent = t.title;
  $('#np-artist').textContent = t.artist;
  $('#np-album').textContent = t.album || '';
  document.querySelectorAll('.track-row.playing').forEach(e => e.classList.remove('playing'));
  const row = document.querySelector(`.track-row[data-id="${t.id}"]`);
  if (row) row.classList.add('playing');
  renderQueue();
  document.title = `${t.title} • ${t.artist} — Tunebox`;
}

/* ---------------- Likes & playlists ---------------- */
function toggleLike(id) {
  liked.has(id) ? liked.delete(id) : liked.add(id);
  saveLS(); syncPlayerUI();
  if (currentView.name === 'spotify' || currentView.name === 'free') {
    // don't refetch remote data; just flip the buttons in place
    document.querySelectorAll(`[data-like="${id}"]`).forEach(b => {
      const on = liked.has(id);
      b.classList.toggle('liked', on);
      b.innerHTML = on ? '&#9829;' : '&#9825;';
    });
  } else rerender();
}
function createPlaylist() {
  openModal('New playlist',
    `<input id="m-pl-name" class="sp-input" placeholder="Playlist name" maxlength="60" autocomplete="off">`,
    [
      { label: 'Cancel', onClick: close => close() },
      {
        label: 'Create', primary: true, onClick: close => {
          const input = document.getElementById('m-pl-name');
          const name = input.value.trim();
          if (!name) { input.focus(); return; }
          playlists.push({ id: 'p' + Date.now(), name, trackIds: [], desc: 'Your playlist.', hue: Math.floor(Math.random() * 360), updatedAt: Date.now() });
          saveLS(); renderSidebar(); close(); toast('Playlist created');
          go('playlist', playlists[playlists.length - 1].id);
        }
      },
    ]);
  const input = document.getElementById('m-pl-name');
  setTimeout(() => input.focus(), 60);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.querySelector('#modal-actions .sp-btn').click();
  });
}
function addToPlaylist(trackId) {
  if (!playlists.length) { createPlaylist(); return; }
  const t = trackById(trackId) || {};
  openModal('Add to playlist',
    `<div class="m-track">${esc(t.title || 'Track')} <span>• ${esc(t.artist || '')}</span></div>
     <div class="m-list">${playlists.map((p, i) => `
       <button class="m-pl" data-i="${i}">
         ${plPosterHTML(p.trackIds, p.hue, 'pl-cover', '&#9835;')}
         <span class="m-pl-name">${esc(p.name)}</span>
         <span class="pl-sub">${p.trackIds.length} songs</span>
       </button>`).join('')}</div>`,
    [{ label: 'Cancel', onClick: close => close() }]);
  document.querySelectorAll('.m-pl').forEach(b => b.addEventListener('click', () => {
    const p = playlists[+b.dataset.i];
    if (p && !p.trackIds.includes(trackId)) {
      p.trackIds.push(trackId); p.updatedAt = Date.now(); saveLS(); toast(`Added to ${p.name}`);
    } else toast('Already in that playlist');
    closeModal();
    if (currentView.name !== 'spotify' && currentView.name !== 'free') rerender();
  }));
}

/* ---------------- Rendering: sidebar ---------------- */
function renderSidebar() {
  const el = $('#playlist-list');
  const likedPl = { id: '__liked', name: 'Liked Songs', count: liked.size, hue: 265, heart: true };
  el.innerHTML = [likedPl, ...playlists].map(p => `
    <button class="pl-item" data-pl="${p.id}">
      ${plPosterHTML(p.heart ? [...liked] : p.trackIds, p.hue, 'pl-cover', p.heart ? '&#9829;' : '&#9835;')}
      <div><div class="pl-name">${esc(p.name)}</div>
      <div class="pl-sub">${p.heart ? p.count + ' songs' : (p.trackIds.length + ' songs')}</div></div>
    </button>`).join('');
  el.querySelectorAll('[data-pl]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.pl;
    id === '__liked' ? go('liked') : go('playlist', id);
  }));
}

/* ---------------- Rendering: views ---------------- */
function trackRow(t, i, ctxIds) {
  const isLiked = liked.has(t.id);
  const dl = (t.blobUrl || t.src) ? `<button class="dl-btn" data-dl="${t.id}" title="Download audio file">&#8681;</button>` : '';
  return `<tr class="track-row" data-id="${t.id}">
    <td><button class="row-play">${i + 1}</button></td>
    <td><div class="t-cell">${coverHTML(t, 't-cover')}
      <div><div class="t-title">${esc(t.title)}</div><div class="t-artist">${esc(t.artist)}</div></div></div></td>
    <td class="t-album">${esc(t.album || '—')}</td>
    <td class="t-dur">${fmt(t.duration)}</td>
    <td class="row-actions">${dl}<button class="like-btn ${isLiked ? 'liked' : ''}" data-like="${t.id}">${isLiked ? '&#9829;' : '&#9825;'}</button></td>
  </tr>`;
}

/* Free, legal downloads: every track with a direct audio file (your library,
   uploads, Audius, Internet Archive) can be saved. Spotify tracks play only
   inside Spotify, and YouTube videos play in YouTube's own player — neither
   offers a legal free download, so no button is shown for them. */
async function downloadTrack(id) {
  const t = trackById(id);
  const srcUrl = t && (t.blobUrl || t.src);
  if (!srcUrl) return;
  const base = srcUrl.split('?')[0].split('#')[0];
  const ext0 = (base.split('.').pop() || '').toLowerCase();
  const extFromUrl = ['mp3', 'wav', 'ogg', 'oga', 'flac', 'm4a', 'opus', 'webm'].includes(ext0) ? ext0 : null;
  const extFromType = { 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/flac': 'flac', 'audio/mp4': 'm4a', 'audio/aac': 'm4a', 'audio/webm': 'webm', 'audio/opus': 'opus' };
  try {
    const res = await fetch(srcUrl);
    if (!res.ok) throw new Error('fetch failed');
    const blob = await res.blob();
    const ext = extFromUrl || extFromType[blob.type] || 'mp3';
    const name = `${t.artist} - ${t.title}.${ext}`.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
    toast('Download started');
  } catch (e) {
    window.open(srcUrl, '_blank'); // fallback: let the browser save or play it
    toast('Opened in a new tab — save it from there');
  }
}
function bindTrackRows(ctxIds) {
  document.querySelectorAll('.track-row').forEach(r => {
    const id = r.dataset.id;
    r.addEventListener('click', e => {
      if (e.target.closest('[data-like]') || e.target.closest('[data-dl]')) return;
      playTrackById(id, ctxIds);
    });
    r.addEventListener('dblclick', () => addToPlaylist(id));
  });
  document.querySelectorAll('[data-like]').forEach(b =>
    b.addEventListener('click', e => { e.stopPropagation(); toggleLike(b.dataset.like); }));
  document.querySelectorAll('[data-dl]').forEach(b =>
    b.addEventListener('click', e => { e.stopPropagation(); downloadTrack(b.dataset.dl); }));
}

function playlistHeader(p, ids) {
  return `<div class="pl-header">
    ${plPosterHTML(ids, p.hue, 'pl-big-cover', p.heart ? '&#9829;' : '&#9835;')}
    <div><div class="pl-type">${p.heart ? 'Playlist' : 'Playlist'}</div>
      <div class="pl-title-big">${esc(p.name)}</div>
      <div class="pl-meta">${esc(p.desc || '')} • ${ids.length} songs, ${fmt(totalDur(ids))}</div></div>
  </div>
  <div class="pl-actions">
    <button class="big-play" id="pl-play">&#9654;</button>
    ${p.heart ? '' : `<button class="ghost-btn" id="pl-delete">Delete playlist</button>`}
  </div>`;
}
function trackTable(ids) {
  if (!ids.length) return `<div class="empty">Nothing here yet. Add some tracks!</div>`;
  return `<table class="track-table"><thead><tr><th>#</th><th>Title</th><th>Album</th><th style="text-align:right">Time</th><th></th></tr></thead>
    <tbody>${ids.map((id, i) => { const t = trackById(id); return t ? trackRow(t, i) : ''; }).join('')}</tbody></table>`;
}

/* ---------------- Personal recommendations: your taste profile + Made-for-you mixes ---------------- */
function trackTags(t) {
  const tags = [...(t.tags || [])].map(x => String(x).toLowerCase());
  if (t.genre) tags.push(String(t.genre).toLowerCase());
  return tags;
}
/* Taste profile: liked songs count 3x, every play counts 1x. Returns [[tag, score], ...]. */
function tasteProfile() {
  const scores = {};
  const add = (t, w) => trackTags(t).forEach(tag => { scores[tag] = (scores[tag] || 0) + w; });
  liked.forEach(id => { const t = trackById(id); if (t) add(t, 3); });
  listenLog.forEach(id => { const t = trackById(id); if (t) add(t, 1); });
  return Object.entries(scores).sort((a, b) => b[1] - a[1]);
}
function topPlayedIds(n) {
  const counts = {};
  listenLog.forEach(id => { counts[id] = (counts[id] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n).map(e => e[0]).filter(id => trackById(id));
}
const MOOD_TAGS = {
  chill:  ['chill', 'ambient', 'lofi', 'acoustic', 'folk', 'jazz', 'classical', 'r&b/soul', 'world'],
  energy: ['workout', 'electronic', 'dance', 'edm', 'hip-hop', 'hip-hop/rap', 'pop', 'rock', 'punk', 'metal', 'latin', 'reggae'],
  focus:  ['ambient', 'classical', 'jazz', 'acoustic', 'lofi', 'piano'],
};
let mixCache = {};
const poolTracks = () => [...library, ...Object.values(audiusTrackCache)];
function buildMoodMix(tags, n = 20) {
  const pool = poolTracks();
  const ids = [];
  const push = t => { if (t && !ids.includes(t.id) && ids.length < n) ids.push(t.id); };
  for (const tag of tags) for (const t of pool) if (trackTags(t).includes(tag)) push(t);
  return ids;
}
function buildMyMix() {
  const topTags = tasteProfile().slice(0, 3).map(e => e[0]);
  const ids = [];
  const push = id => { if (id && trackById(id) && !ids.includes(id) && ids.length < 25) ids.push(id); };
  [...liked].sort(() => Math.random() - 0.5).forEach(push);
  topPlayedIds(15).forEach(push);
  const pool = poolTracks();
  for (const tag of topTags) for (const t of pool) if (trackTags(t).includes(tag)) push(t.id);
  if (ids.length < 8) pool.map(t => t.id).sort(() => Math.random() - 0.5).forEach(push);
  return ids;
}
let freshCache = null;
async function buildFreshMix() {
  if (freshCache) return freshCache;
  const fav = tasteProfile().slice(0, 3).map(e => e[0]);
  const items = await auApi('/tracks/trending?limit=50');
  const known = new Set([...liked, ...listenLog]);
  const ids = [];
  const consider = (item, matchGenre) => {
    if (!item || !item.id || item.is_streamable === false) return;
    const id = 'au:' + item.id;
    if (known.has(id) || ids.includes(id)) return;
    if (matchGenre) {
      const g = String(item.genre || '').toLowerCase();
      if (fav.length && !fav.some(tag => g.includes(tag) || tag.includes(g))) return;
    }
    ids.push(auTrack(item).id);
  };
  items.forEach(it => consider(it, true));
  if (ids.length < 8) items.forEach(it => consider(it, false));
  freshCache = ids.slice(0, 15);
  return freshCache;
}
function buildMixes() {
  mixCache = {
    mymix:  { id: 'mymix',  name: 'My Mix',     desc: 'Your favorites and most-played, plus more like them.', hue: 285, trackIds: buildMyMix() },
    chill:  { id: 'chill',  name: 'Chill Mix',  desc: 'Easy-going picks for winding down.',                    hue: 200, trackIds: buildMoodMix(MOOD_TAGS.chill) },
    energy: { id: 'energy', name: 'Energy Mix', desc: 'Upbeat tracks to move to.',                             hue: 8,   trackIds: buildMoodMix(MOOD_TAGS.energy) },
    focus:  { id: 'focus',  name: 'Focus Mix',  desc: 'Calm sound for deep work.',                             hue: 260, trackIds: buildMoodMix(MOOD_TAGS.focus) },
  };
}
function renderMix(id) {
  const m = mixCache[id];
  if (!m || !m.trackIds.length) { go('home'); return; }
  const savedId = 'saved-' + id;
  const saved = playlists.some(p => p.id === savedId);
  $('#view').innerHTML =
    playlistHeader({ name: m.name, desc: m.desc + ' • Made for you', hue: m.hue }, m.trackIds) +
    (saved ? '' : `<div class="pl-actions"><button class="ghost-btn" id="mix-save">Save as playlist</button></div>`) +
    trackTable(m.trackIds);
  $('#pl-play').addEventListener('click', () => { setQueue(m.trackIds, 0); playCurrent(); });
  const sv = $('#mix-save');
  if (sv) sv.addEventListener('click', () => {
    playlists.push({ id: savedId, name: m.name, desc: m.desc, trackIds: [...m.trackIds], hue: m.hue });
    saveLS(); renderSidebar(); renderMix(id);
  });
  bindTrackRows(m.trackIds);
}

/* ---------------- Featured album detail ---------------- */
function renderAlbum(id) {
  const a = FEATURED_ALBUMS.find(x => x.id === id);
  if (!a) { go('home'); return; }
  const tracks = albumTracks(a);
  const ids = tracks.map(t => t.id);
  $('#view').innerHTML = `
    <div class="pl-header">
      <img class="pl-big-cover" src="${esc(a.cover)}" data-poster="${posterURL(a.title, 222)}" alt="">
      <div><div class="pl-type">Album • ${esc(a.label || '')}</div>
        <div class="pl-title-big">${esc(a.title)}</div>
        <div class="pl-meta">${esc(a.artist)} • ${a.year || ''} • ${tracks.length} songs, ${fmt(tracks.reduce((s, t) => s + (t.duration || 0), 0))}</div>
        ${a.blurb ? `<div class="pl-meta" style="margin-top:8px;max-width:560px">${esc(a.blurb)}</div>` : ''}
        <div class="pl-actions" style="margin-top:12px"><button class="big-play" id="album-play">&#9654;</button></div>
      </div>
    </div>
    <div class="section-title">Tracks</div>
    ${trackTable(ids)}
    <div class="sp-note" style="margin-top:14px">Plays free via YouTube audio · Ad Silencer auto-mutes any ads.</div>`;
  $('#album-play').addEventListener('click', () => playAlbum(a, 0));
  bindTrackRows(ids);
}

async function renderHome() {
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const quick = [...playlists].slice(0, 6);
  const cards = playlists.map(p => `
    <button class="card" data-pl="${p.id}">
      ${plPosterHTML(p.trackIds, p.hue, 'c-cover', '&#9835;')}
      <div class="c-title">${esc(p.name)}</div><div class="c-sub">${esc(p.desc || p.trackIds.length + ' songs')}</div>
      <span class="c-play" data-play-pl="${p.id}">&#9654;</span>
    </button>`).join('');
  buildMixes();
  try {
    const freshIds = await buildFreshMix();
    if (freshIds.length) mixCache.fresh = { id: 'fresh', name: 'Fresh Finds', desc: 'New tracks matching your taste.', hue: 150, trackIds: freshIds };
  } catch (e) { /* Fresh Finds is optional — home must never break */ }
  const mixes = Object.values(mixCache).filter(m => m.trackIds.length);
  const mixCards = mixes.map(m => `
    <button class="card" data-mix="${m.id}">
      ${plPosterHTML(m.trackIds, m.hue, 'c-cover', '&#9835;')}
      <div class="c-title">${esc(m.name)}</div><div class="c-sub">${m.trackIds.length} songs • Made for you</div>
      <span class="c-play" data-play-mix="${m.id}">&#9654;</span>
    </button>`).join('');
  const recents = [...new Set([...listenLog].reverse())].map(id => trackById(id)).filter(Boolean).slice(0, 12);
  const recentRow = recents.length ? `
    <div class="section-title">Jump Back In</div>
    <div class="rec-row">${recents.map(t => `
      <button class="rec-card" data-rec="${t.id}">
        ${coverHTML(t, 'rec-cover')}
        <div class="t-title">${esc(t.title)}</div>
        <div class="t-artist">${esc(t.artist)}</div>
      </button>`).join('')}</div>` : '';
  $('#view').innerHTML = `
    <div class="greeting">${greet}</div>
    <div class="quick-grid">${quick.map(p => `
      <button class="quick-card" data-pl="${p.id}">
        ${plPosterHTML(p.trackIds, p.hue, 'qc-cover', '&#9835;')}
        <span>${esc(p.name)}</span>
      </button>`).join('')}</div>
    ${recentRow}
    ${mixes.length ? `<div class="section-title">Made for You</div><div class="card-grid">${mixCards}</div>` : ''}
    ${FEATURED_ALBUMS.length ? `<div class="section-title">Featured albums</div><div class="card-grid">${FEATURED_ALBUMS.map(a => `
      <button class="card" data-album="${a.id}">
        <img class="c-cover" src="${esc(a.cover)}" data-poster="${posterURL(a.title, 222)}" alt="" loading="lazy">
        <div class="c-title">${esc(a.title)}</div><div class="c-sub">${esc(a.artist)} • ${a.tracks.length} songs</div>
        <span class="c-play" data-play-album="${a.id}">&#9654;</span>
      </button>`).join('')}</div>` : ''}
    <div class="section-title">Your Playlists</div>
    <div class="card-grid">${cards}</div>
    <div id="home-yt">
      <div class="section-title">Trending on YouTube</div>
      <div class="skel-row">${'<div class="skel-thumb"><div class="skel skel-cover"></div><div class="skel skel-line"></div><div class="skel skel-line short"></div></div>'.repeat(5)}</div>
    </div>
    <div id="home-recs"></div>
    <div class="section-title">All tracks</div>
    ${trackTable(library.map(t => t.id))}`;
  bindCards(); bindTrackRows(library.map(t => t.id));
  document.querySelectorAll('[data-mix]').forEach(c => c.addEventListener('click', e => {
    if (e.target.closest('[data-play-mix]')) return;
    go('mix', c.dataset.mix);
  }));
  document.querySelectorAll('[data-play-mix]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const m = mixCache[b.dataset.playMix];
    if (m && m.trackIds.length) { setQueue(m.trackIds, 0); playCurrent(); }
  }));
  document.querySelectorAll('[data-rec]').forEach(b => b.addEventListener('click', () => {
    playTrackById(b.dataset.rec, recents.map(t => t.id));
  }));
  document.querySelectorAll('[data-album]').forEach(c => c.addEventListener('click', e => {
    if (e.target.closest('[data-play-album]')) return;
    go('album', c.dataset.album);
  }));
  document.querySelectorAll('[data-play-album]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const a = FEATURED_ALBUMS.find(x => x.id === b.dataset.playAlbum);
    if (a) playAlbum(a, 0);
  }));
  // YouTube trending (fails silently — home must never break)
  try {
    const trends = await ytTrending();
    const box = $('#home-yt');
    if (!box) return;
    if (!trends.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="section-title">Trending on YouTube</div><div class="trend-row">` +
      trends.map(v => `
        <button class="trend-card" data-vid="${v.id}" data-title="${esc(v.title)}" data-channel="${esc(v.channel)}">
          ${v.thumb ? `<img src="${esc(v.thumb)}" data-poster="${posterURL(v.title, hueFor(v.id))}" alt="" loading="lazy">` : posterImg(v.title, hueFor(v.id), '')}
          <div class="t-title">${esc(v.title)}</div>
          <div class="t-artist">${esc(v.channel)}${v.dur ? ' • ' + fmt(v.dur) : ''}</div>
        </button>`).join('') + `</div>`;
    box.querySelectorAll('.trend-card').forEach(b => b.addEventListener('click', () => {
      ytPendingPlay = { id: b.dataset.vid, title: b.dataset.title, channel: b.dataset.channel };
      freeSource = 'youtube'; go('free');
    }));
  } catch (e) { const box = $('#home-yt'); if (box) box.innerHTML = ''; }
  // Recommended for you — YouTube's algorithm, seeded from your taste (fails silently)
  try {
    const recs = await ytRecommendations();
    const box = $('#home-recs');
    if (!box) return;
    if (!recs.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="section-title">Recommended for you</div>
      <div class="sp-note" style="margin:-6px 0 10px">YouTube picks based on your listening taste.</div>
      <div class="trend-row">` +
      recs.map(v => `
        <button class="trend-card" data-vid="${v.id}" data-title="${esc(v.title || 'YouTube video')}" data-channel="${esc(v.channel || '')}">
          ${v.thumb ? `<img src="${esc(v.thumb)}" data-poster="${posterURL(v.title, hueFor(v.id))}" alt="" loading="lazy">` : posterImg(v.title, hueFor(v.id), '')}
          <div class="t-title">${esc(v.title || 'YouTube video')}</div>
          <div class="t-artist">${esc(v.channel || '')}</div>
        </button>`).join('') + `</div>`;
    box.querySelectorAll('.trend-card').forEach(b => b.addEventListener('click', () => {
      ytPendingPlay = { id: b.dataset.vid, title: b.dataset.title, channel: b.dataset.channel };
      freeSource = 'youtube'; go('free');
    }));
  } catch (e) { const box = $('#home-recs'); if (box) box.innerHTML = ''; }
}
function bindCards() {
  document.querySelectorAll('[data-pl]').forEach(c => c.addEventListener('click', e => {
    if (e.target.closest('[data-play-pl]')) return;
    const id = c.dataset.pl;
    id === '__liked' ? go('liked') : go('playlist', id);
  }));
  document.querySelectorAll('[data-play-pl]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const p = playlists.find(x => x.id === b.dataset.playPl);
    if (p && p.trackIds.length) { setQueue(p.trackIds, 0); playCurrent(); }
  }));
}

/* ---------------- Unified search: your library + Spotify + YouTube + Audius + Archive ---------------- */
let uniSeq = 0;
async function renderSearch(q) {
  const query = (q || '').trim();
  const seq = ++uniSeq;
  const alive = () => seq === uniSeq && currentView.name === 'search';
  if (!query) {
    $('#view').innerHTML = `<div class="greeting">Browse all</div><div class="cat-grid">${CATEGORIES.map(c => `
      <button class="cat-card" data-q="${c.q}" style="background:linear-gradient(135deg,hsl(${c.hue},65%,42%),hsl(${(c.hue+40)%360},70%,26%))">${c.name}</button>`).join('')}</div>`;
    document.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => {
      $('#search-input').value = b.dataset.q;
      currentView.arg = b.dataset.q; history[hIndex].arg = b.dataset.q; renderSearch(b.dataset.q);
    }));
    return;
  }
  const ql = query.toLowerCase();
  const hits = library.filter(t => (t.title + ' ' + t.artist + ' ' + (t.album || '')).toLowerCase().includes(ql)).map(t => t.id);
  const plHits = playlists.filter(p => p.name.toLowerCase().includes(ql));
  let html = `<div class="section-title">Results for &ldquo;${esc(query)}&rdquo;</div>`;
  if (plHits.length || hits.length) {
    html += `<div class="uni-sec"><div class="section-title" style="font-size:17px">Your library</div>`;
    if (plHits.length) html += `<div class="card-grid">${plHits.map(p => `
      <button class="card" data-pl="${p.id}">
        ${plPosterHTML(p.trackIds, p.hue, 'c-cover', '&#9835;')}
        <div class="c-title">${esc(p.name)}</div><div class="c-sub">${p.trackIds.length} songs</div>
      </button>`).join('')}</div>`;
    if (hits.length) html += trackTable(hits);
    html += `</div>`;
  }
  html += `<div id="uni-sp"></div><div id="uni-yt"></div><div id="uni-au"></div><div id="uni-ia"></div>
    <div id="uni-empty" class="empty" hidden>No results for &ldquo;${esc(query)}&rdquo; anywhere. Try something else.</div>`;
  $('#view').innerHTML = html;
  bindCards(); bindTrackRows(hits);
  const spBox = $('#uni-sp'), ytBox = $('#uni-yt'), auBox = $('#uni-au'), iaBox = $('#uni-ia');
  let finished = 0;
  const finish = () => {
    if (!alive() || ++finished < 4) return;
    if (!$('#view').querySelector('.uni-sec')) $('#uni-empty').hidden = false;
  };
  // Spotify (only when connected)
  (async () => {
    if (!hasTokens()) {
      spBox.innerHTML = `<div class="uni-hint">Spotify isn't connected — <a id="uni-sp-go">connect Spotify</a> to search it here too.</div>`;
      const g = $('#uni-sp-go'); if (g) g.addEventListener('click', () => go('spotify'));
      finish(); return;
    }
    spBox.innerHTML = skelRow(4, 'Spotify');
    try {
      const data = await spApi('/v1/search?' + new URLSearchParams({ q: query, type: 'track', limit: '8' }));
      if (!alive()) return;
      const tracks = (data.tracks?.items || []).filter(t => t?.uri);
      const ids = tracks.map(t => spTrack(t).id);
      if (ids.length) {
        spBox.innerHTML = `<div class="section-title" style="font-size:17px">Spotify</div><div class="uni-sec">` + trackTable(ids) + `</div>`;
        bindTrackRows(ids);
      } else spBox.innerHTML = '';
    } catch (e) { if (alive()) spBox.innerHTML = ''; }
    finish();
  })();
  // YouTube via the Tunebox backend — the API key stays on the server
  (async () => {
    const be = backendUrl();
    if (!be) {
      ytBox.innerHTML = `<div class="uni-hint">YouTube search needs the backend — <a id="uni-be-go">connect it in Free Music → YouTube</a>.</div>`;
      const g = $('#uni-be-go');
      if (g) g.addEventListener('click', () => { freeSource = 'youtube'; go('free'); });
      finish(); return;
    }
    ytBox.innerHTML = skelRow(4, 'YouTube');
    await new Promise(r => setTimeout(r, 500));
    if (!alive()) return;
    try {
      const res = await fetch(be + '/api/yt/search?' + new URLSearchParams({ q: query }));
      if (!res.ok) throw new Error('Backend error ' + res.status);
      const items = await res.json();
      if (!alive()) return;
      if (items.length) {
        ytBox.innerHTML = `<div class="section-title" style="font-size:17px">YouTube</div><div class="uni-sec">
          <div id="uni-yt-player"></div><div class="yt-list">` +
          items.map(v => `
            <div class="yt-item" data-vid="${esc(v.id)}" data-title="${esc(v.title || 'YouTube video')}" data-channel="${esc(v.channel || '')}">
              ${v.thumb ? `<img class="yt-thumb" src="${esc(v.thumb)}" data-poster="${posterURL(v.title, hueFor(v.id))}" alt="" loading="lazy">` : posterImg(v.title, hueFor(v.id), 'yt-thumb')}
              <div class="yt-meta"><div class="t-title">${esc(v.title || 'YouTube video')}</div><div class="t-artist">${esc(v.channel || '')}</div></div>
            </div>`).join('') + `</div></div>`;
        ytBox.querySelectorAll('.yt-item').forEach(el => el.addEventListener('click', () =>
          ytShowPlayer(el.dataset.vid, el.dataset.title, el.dataset.channel, 'uni-yt-player')));
      } else ytBox.innerHTML = '';
    } catch (e) { if (alive()) ytBox.innerHTML = ''; }
    finish();
  })();
  // Audius (free music, no account)
  (async () => {
    auBox.innerHTML = skelRow(4, 'Audius — free music');
    try {
      const items = await auApi('/tracks/search?query=' + encodeURIComponent(query) + '&limit=15');
      if (!alive()) return;
      const ids = items.filter(t => t && t.id && t.is_streamable !== false).map(t => auTrack(t).id);
      if (ids.length) {
        auBox.innerHTML = `<div class="section-title" style="font-size:17px">Audius — free music</div><div class="uni-sec">` + trackTable(ids) + `</div>`;
        bindTrackRows(ids);
      } else auBox.innerHTML = '';
    } catch (e) { if (alive()) auBox.innerHTML = ''; }
    finish();
  })();
  // Internet Archive (collections)
  (async () => {
    iaBox.innerHTML = skelRow(4, 'Internet Archive');
    try {
      const docs = await iaSearch(query);
      if (!alive()) return;
      const top = docs.slice(0, 6);
      if (top.length) {
        iaBox.innerHTML = `<div class="section-title" style="font-size:17px">Internet Archive</div><div class="uni-sec"><div class="card-grid">` +
          top.map(d => {
            const poster = posterURL(d.title || d.identifier, hueFor(d.identifier));
            return `<button class="card" data-iaid="${esc(d.identifier)}">
              <img class="c-cover" src="https://archive.org/services/img/${esc(d.identifier)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${poster}'">
              <div class="c-title">${esc(d.title || d.identifier)}</div>
              <div class="c-sub">${esc(d.creator || '')}${d.year ? ' • ' + esc(d.year) : ''}</div></button>`;
          }).join('') + `</div></div>`;
        iaBox.querySelectorAll('[data-iaid]').forEach(b => b.addEventListener('click', () => {
          iaItemId = b.dataset.iaid; freeSource = 'archive'; go('free');
        }));
      } else iaBox.innerHTML = '';
    } catch (e) { if (alive()) iaBox.innerHTML = ''; }
    finish();
  })();
}

function renderPlaylist(id) {
  const p = playlists.find(x => x.id === id);
  if (!p) { go('home'); return; }
  $('#view').innerHTML = playlistHeader(p, p.trackIds) + trackTable(p.trackIds);
  $('#pl-play').addEventListener('click', () => { if (p.trackIds.length) { setQueue(p.trackIds, 0); playCurrent(); } });
  const del = $('#pl-delete');
  if (del) del.addEventListener('click', () => {
    openModal('Delete playlist',
      `<p class="m-note">"${esc(p.name)}" will be removed from your library.</p>`,
      [
        { label: 'Cancel', onClick: close => close() },
        {
          label: 'Delete', primary: true, onClick: close => {
            deletedPls[id] = Date.now();
            playlists = playlists.filter(x => x.id !== id);
            saveLS(); renderSidebar(); close(); toast('Playlist deleted'); go('home');
          }
        },
      ]);
  });
  bindTrackRows(p.trackIds);
}
function renderLiked() {
  const ids = [...liked].filter(id => trackById(id));
  const p = { name: 'Liked Songs', desc: 'Everything you loved.', hue: 265, heart: true };
  $('#view').innerHTML = playlistHeader(p, ids) + trackTable(ids);
  $('#pl-play').addEventListener('click', () => { if (ids.length) { setQueue(ids, 0); playCurrent(); } });
  bindTrackRows(ids);
}

function rerender() {
  if (currentView.name === 'home') renderHome();
  else if (currentView.name === 'search') renderSearch(currentView.arg);
  else if (currentView.name === 'playlist') renderPlaylist(currentView.arg);
  else if (currentView.name === 'mix') renderMix(currentView.arg);
  else if (currentView.name === 'album') renderAlbum(currentView.arg);
  else if (currentView.name === 'liked') renderLiked();
  else if (currentView.name === 'spotify') renderSpotify();
  else if (currentView.name === 'free') renderFree();
  renderSidebar();
}

/* ---------------- Navigation ---------------- */
function go(name, arg) {
  history = history.slice(0, hIndex + 1);
  history.push({ name, arg }); hIndex++;
  currentView = { name, arg };
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === name));
  document.body.classList.remove('nav-open');
  if (name === 'search' && arg) $('#search-input').value = arg;
  rerender();
}
function navHist(d) {
  const n = hIndex + d;
  if (n < 0 || n >= history.length) return;
  hIndex = n; currentView = history[n];
  document.querySelectorAll('.nav-item').forEach(x => x.classList.toggle('active', x.dataset.view === currentView.name));
  rerender();
}

/* ---------------- Queue panel ---------------- */
function renderQueue() {
  const el = $('#queue-list');
  if (!queue.length) { el.innerHTML = `<div class="empty">Queue is empty.</div>`; return; }
  el.innerHTML = queue.map((id, i) => {
    const t = trackById(id); if (!t) return '';
    return `<button class="q-item ${i === qi ? 'current' : ''}" data-qi="${i}">
      ${coverHTML(t, 't-cover')}
      <div><div style="font-weight:600">${esc(t.title)}</div><div style="color:var(--muted);font-size:12px">${esc(t.artist)}</div></div>
    </button>`;
  }).join('');
  el.querySelectorAll('[data-qi]').forEach(b => b.addEventListener('click', () => { qi = +b.dataset.qi; playCurrent(); }));
}

/* ---------------- Uploads ---------------- */
async function handleFiles(files) {
  let added = 0;
  for (const f of files) {
    const id = 'u' + Date.now() + added;
    await idbPut(id, f);
    const url = URL.createObjectURL(f);
    const title = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
    try { localStorage.setItem('tunebox.meta.' + id, JSON.stringify(title || 'Untitled')); } catch (e) {}
    library.push({ id, title: title || 'Untitled', artist: 'Unknown Artist', album: 'Uploads', blobUrl: url, duration: 0, hue: Math.floor(Math.random() * 360), tags: [] });
    const probe = new Audio(); probe.preload = 'metadata'; probe.src = url;
    probe.onloadedmetadata = () => { const t = trackById(id); if (t) { t.duration = probe.duration; if (currentView.name !== 'search') rerender(); } };
    added++;
  }
  let up = playlists.find(p => p.id === 'pl-uploads');
  if (!up) { up = { id: 'pl-uploads', name: 'Your Uploads', desc: 'Music you added.', trackIds: [], hue: 150 }; playlists.push(up); }
  library.slice(-added).forEach(t => { if (!up.trackIds.includes(t.id)) up.trackIds.push(t.id); });
  saveLS(); renderSidebar(); rerender();
  if (added) toast(added === 1 ? 'Added to your library' : `${added} tracks added to your library`);
}

/* ---------------- Wire up ---------------- */
async function init() {
  loadLS(); loadAuCache(); loadIaCache(); seedPlaylists(); renderSidebar(); renderQueue();
  ensureBackend().catch(() => {}); // drop dead custom backend URLs before anything uses them
  document.querySelectorAll('.nav-item').forEach(n => n.addEventListener('click', () => go(n.dataset.view)));
  $('#back').addEventListener('click', () => navHist(-1));
  $('#fwd').addEventListener('click', () => navHist(1));
  $('#create-playlist').addEventListener('click', createPlaylist);
  $('#upload-btn').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', e => { handleFiles([...e.target.files]); e.target.value = ''; });
  $('#play').addEventListener('click', togglePlay);
  $('#next').addEventListener('click', () => step(1));
  $('#prev').addEventListener('click', () => step(-1));
  $('#shuffle').addEventListener('click', e => { shuffle = !shuffle; e.currentTarget.classList.toggle('on', shuffle); });
  $('#repeat').addEventListener('click', e => {
    repeatMode = repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off';
    e.currentTarget.classList.toggle('on', repeatMode !== 'off');
    e.currentTarget.textContent = repeatMode === 'one' ? '🔂' : '🔁';
    if (repeatMode === 'off') e.currentTarget.innerHTML = '&#8635;';
  });
  $('#pb-like').addEventListener('click', () => { const t = currentTrack(); if (t) toggleLike(t.id); });
  $('#queue-toggle').addEventListener('click', () => { $('#queue-panel').hidden = !$('#queue-panel').hidden; });
  $('#queue-close').addEventListener('click', () => { $('#queue-panel').hidden = true; });
  $('#np-close').addEventListener('click', () => { $('#nowplaying').hidden = true; });
  const seek = $('#seek');
  seek.addEventListener('pointerdown', () => seeking = true);
  seek.addEventListener('pointerup', () => seeking = false);
  seek.addEventListener('input', () => {
    if (ytMode && ytPlayer) { const d = ytPlayer.getDuration(); if (d) ytPlayer.seekTo(seek.value / 1000 * d, true); }
    else if (currentIsSpotify()) { if (spPlayer && spDuration) spPlayer.seek(Math.round(seek.value / 1000 * spDuration)).catch(() => {}); }
    else if (audio.duration) audio.currentTime = seek.value / 1000 * audio.duration;
  });
  const vol = $('#volume');
  vol.addEventListener('input', () => {
    const v = vol.value / 100;
    if (ytMode && ytPlayer) ytPlayer.setVolume(Math.round(v * 100));
    else if (currentIsSpotify() && spPlayer) { spPlayer.setVolume(v).catch(() => {}); spMutedVol = null; $('#mute').innerHTML = '&#128266;'; }
    else { audio.volume = v; audio.muted = false; }
  });
  $('#mute').addEventListener('click', () => {
    if (ytMode && ytPlayer) {
      const m = ytPlayer.isMuted();
      m ? ytPlayer.unMute() : ytPlayer.mute();
      if (typeof adSilMuted !== 'undefined' && adSilMuted) adSilUserMuted = !m; // respect manual mute during a silenced ad
      $('#mute').innerHTML = m ? '&#128266;' : '&#128263;';
    }
    else if (currentIsSpotify() && spPlayer) {
      if (spMutedVol === null) spPlayer.getVolume().then(v => { spMutedVol = v; spPlayer.setVolume(0); $('#mute').innerHTML = '&#128263;'; }).catch(() => {});
      else { spPlayer.setVolume(spMutedVol).catch(() => {}); spMutedVol = null; $('#mute').innerHTML = '&#128266;'; }
    } else { audio.muted = !audio.muted; $('#mute').innerHTML = audio.muted ? '&#128263;' : '&#128266;'; }
  });
  let searchTimer;
  $('#search-input').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const v = e.target.value;
      if (currentView.name === 'search') {
        currentView.arg = v; history[hIndex].arg = v; renderSearch(v);
      } else go('search', v);
    }, 300);
  });
  $('#menu-btn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  $('#scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));
  $('#modal-scrim').addEventListener('click', e => { if (e.target.id === 'modal-scrim') closeModal(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#modal-scrim').hidden) closeModal();
  });
  document.addEventListener('keydown', e => {
    if (e.code === 'Space' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); togglePlay(); }
  });

  idbOpen().then(async () => {
    try {
      const files = await idbAll();
      let up = playlists.find(p => p.id === 'pl-uploads');
      for (const [id, blob] of files) {
        if (trackById(id)) continue;
        const url = URL.createObjectURL(blob);
        const t = { id, title: id.replace(/^u\d+/, 'Track ') || 'Uploaded track', artist: 'Unknown Artist', album: 'Uploads', blobUrl: url, duration: 0, hue: Math.floor(Math.random() * 360), tags: [] };
        try { t.title = JSON.parse(localStorage.getItem('tunebox.meta.' + id) || 'null') || t.title; } catch (e) {}
        library.push(t);
        if (!up) { up = { id: 'pl-uploads', name: 'Your Uploads', desc: 'Music you added.', trackIds: [], hue: 150 }; playlists.push(up); }
        if (!up.trackIds.includes(id)) up.trackIds.push(id);
        const probe = new Audio(); probe.preload = 'metadata'; probe.src = url;
        probe.onloadedmetadata = () => { t.duration = probe.duration; };
      }
      renderSidebar(); rerender();
    } catch (e) { /* IDB unavailable */ }
  }).catch(() => {});

  const authed = await handleSpotifyReturn().catch(() => false);
  renderAuthArea();
  checkSession().catch(() => {});
  go(authed ? 'spotify' : 'home');
  // Warm up the YouTube player API while idle so the first Play tap stays
  // inside the browser's user-activation window (autoplay with sound allowed).
  const warmYt = () => ensureYtApi().catch(() => {});
  if ('requestIdleCallback' in window) requestIdleCallback(warmYt, { timeout: 8000 });
  else setTimeout(warmYt, 3000);
}
document.addEventListener('DOMContentLoaded', init);

/* ---------------- Spotify: Web Playback SDK + PKCE OAuth (no backend) ---------------- */
const SP_AUTH = 'https://accounts.spotify.com/authorize';
const SP_TOKEN = 'https://accounts.spotify.com/api/token';
const SP_API = 'https://api.spotify.com/v1';
const SP_SCOPES = ['streaming', 'user-read-email', 'user-read-private', 'user-read-playback-state',
  'user-modify-playback-state', 'user-library-read', 'playlist-read-private', 'user-top-read'].join(' ');
const LS_SP_ID = 'tunebox.spotify.clientId';
const DEFAULT_CLIENT_ID = '6657530664d14112bb13e4276d36e893'; // Tunebox app, pre-configured
const LS_SP_TOK = 'tunebox.spotify.tokens';
const SS_SP_VER = 'tunebox.spotify.verifier';

const spotifyTrackCache = {};   // 'sp:<uri>' -> normalized track (also used by trackById)
let spPlayer = null, spDeviceId = null, spReady = false;
let spPlaying = false, spPosition = 0, spDuration = 0;
let spPremium = true, spProfile = null, spAuthError = '', spMutedVol = null;
let spViewState = { tab: 'playlists', playlistId: null, query: '', likedOffset: 0, likedIds: [], allIds: [] };
let spPollTimer = null, spAuthRetryAt = 0;

/* ----- storage ----- */
const getClientId = () => localStorage.getItem(LS_SP_ID) || DEFAULT_CLIENT_ID;
const loadTokens = () => { try { return JSON.parse(localStorage.getItem(LS_SP_TOK) || 'null'); } catch (e) { return null; } };
const saveTokens = t => localStorage.setItem(LS_SP_TOK, JSON.stringify(t));
const hasTokens = () => !!loadTokens()?.access_token;
/* Redirect URI must exactly match one registered in the Spotify dashboard.
   Spotify rejects the "localhost" hostname, so local dev uses the explicit loopback IP.
   The URI is normalized (index.html stripped, trailing slash enforced) so it is
   identical no matter which URL variant of the app the user opened. */
const redirectUri = () => {
  const h = window.location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') return 'http://127.0.0.1:8000';
  let p = window.location.pathname;
  if (p.endsWith('index.html')) p = p.slice(0, -'index.html'.length);
  if (!p.endsWith('/')) p += '/';
  return window.location.origin + p;
};

/* ----- PKCE ----- */
function randStr(n) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  return [...a].map(x => chars[x % chars.length]).join('');
}
function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function pkceChallenge(v) {
  return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)));
}

async function startSpotifyAuth() {
  const clientId = getClientId();
  if (!clientId) { spNotice('Save your Spotify Client ID first.'); return; }
  if (!window.crypto?.subtle) { spNotice('Spotify login needs http(s) — open this page via a local server, not file://.'); return; }
  const verifier = randStr(128);
  sessionStorage.setItem(SS_SP_VER, verifier);
  const challenge = await pkceChallenge(verifier);
  const p = new URLSearchParams({
    response_type: 'code', client_id: clientId, scope: SP_SCOPES,
    code_challenge_method: 'S256', code_challenge: challenge,
    redirect_uri: redirectUri()
  });
  window.location = SP_AUTH + '?' + p.toString();
}

/* Called on page load: exchanges ?code= for tokens, cleans the URL. Returns true if an auth round-trip happened. */
async function handleSpotifyReturn() {
  const q = new URLSearchParams(window.location.search);
  const err = q.get('error'), code = q.get('code');
  if (!err && !code) return false;
  window.history.replaceState({}, '', redirectUri());
  if (err) { spAuthError = 'Spotify login was cancelled (' + err + ').'; return true; }
  try {
    const verifier = sessionStorage.getItem(SS_SP_VER) || '';
    const body = new URLSearchParams({
      grant_type: 'authorization_code', code,
      redirect_uri: redirectUri(), client_id: getClientId(), code_verifier: verifier
    });
    const res = await fetch(SP_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const data = await res.json();
    if (!data.access_token) throw new Error(data.error_description || data.error || 'token exchange failed');
    saveTokens({ access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + data.expires_in * 1000 });
    spAuthError = '';
    sessionStorage.removeItem(SS_SP_VER);
    return true;
  } catch (e) { spAuthError = 'Spotify login failed: ' + e.message; return true; }
}

async function refreshTokens() {
  const tok = loadTokens();
  if (!tok?.refresh_token) throw new Error('no refresh token');
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tok.refresh_token, client_id: getClientId() });
  const res = await fetch(SP_TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const data = await res.json();
  if (!data.access_token) throw new Error(data.error_description || 'refresh failed');
  const ntok = { access_token: data.access_token, refresh_token: data.refresh_token || tok.refresh_token, expires_at: Date.now() + data.expires_in * 1000 };
  saveTokens(ntok);
  return ntok;
}
/* Always call this before using a token — it silently refreshes when close to expiry. */
async function getValidToken() {
  let tok = loadTokens();
  if (!tok?.access_token) throw new Error('Spotify not connected');
  if (Date.now() > tok.expires_at - 60000) tok = await refreshTokens();
  return tok.access_token;
}
async function spApi(path, opts = {}) {
  const token = await getValidToken();
  const url = path.startsWith('http') ? path : SP_API + path; // Spotify paging returns absolute `next` URLs
  const mk = t => fetch(url, { ...opts, headers: { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  let res = await mk(token);
  if (res.status === 401) { // token rejected: force a refresh and retry once
    const t = loadTokens(); if (t) { t.expires_at = 0; saveTokens(t); }
    res = await mk(await getValidToken());
  }
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || ('Spotify API ' + res.status)); }
  return res.status === 204 ? null : res.json();
}

function disconnectSpotify() {
  localStorage.removeItem(LS_SP_TOK);
  if (spPlayer) { spPlayer.disconnect().catch(() => {}); spPlayer = null; }
  stopYt();
  spDeviceId = null; spReady = false; spPlaying = false; spProfile = null; spPremium = true;
  Object.keys(spotifyTrackCache).forEach(k => delete spotifyTrackCache[k]);
  if (currentIsSpotify()) { audio.pause(); queue = []; qi = -1; syncPlayerUI(); }
  spViewState = { tab: 'playlists', playlistId: null, query: '', likedOffset: 0, likedIds: [], allIds: [] };
  rerender();
}

/* ----- Web Playback SDK ----- */
function loadSpotifySDK() {
  return new Promise((res, rej) => {
    if (window.Spotify?.Player) return res();
    const to = setTimeout(() => rej(new Error('SDK load timed out — check your connection')), 20000);
    window.onSpotifyWebPlaybackSDKReady = () => { clearTimeout(to); res(); };
    const s = document.createElement('script');
    s.src = 'https://sdk.scdn.co/spotify-player.js';
    s.onerror = () => { clearTimeout(to); rej(new Error('could not load the Spotify SDK')); };
    document.head.appendChild(s);
  });
}

async function ensureSpotifyPlayer() {
  if (spPlayer) return;
  if (!spPremium) return; // free accounts play through YouTube — no Spotify player needed
  if (!hasTokens()) throw new Error('Connect Spotify first (sidebar → Spotify).');
  await loadSpotifySDK();
  spPlayer = new Spotify.Player({
    name: 'Tunebox Player',
    getOAuthToken: cb => { getValidToken().then(cb).catch(() => cb('')); },
    volume: (($('#volume') && $('#volume').value) || 80) / 100
  });
  spPlayer.addListener('ready', ({ device_id }) => { spDeviceId = device_id; spReady = true; });
  spPlayer.addListener('not_ready', () => { spDeviceId = null; spReady = false; });
  spPlayer.addListener('player_state_changed', onSpotifyState);
  spPlayer.addListener('authentication_error', async () => {
    if (Date.now() < spAuthRetryAt) return;
    spAuthRetryAt = Date.now() + 30000;
    try {
      const t = loadTokens(); if (t) { t.expires_at = 0; saveTokens(t); } // force refresh on next getOAuthToken
      await spPlayer.disconnect(); await spPlayer.connect();
    } catch (e) { spNotice('Spotify session expired — please reconnect.'); }
  });
  spPlayer.addListener('account_error', () => {
    spPremium = false;
    if (currentView.name === 'spotify') renderSpotify();
    spNotice('No Spotify Premium on this account — your Spotify tracks will play free via YouTube.');
  });
  spPlayer.addListener('playback_error', ({ message }) => spNotice('Spotify playback error: ' + message));
  const ok = await spPlayer.connect();
  if (!ok) throw new Error('could not connect the Spotify player');
  if (!spPollTimer) spPollTimer = setInterval(async () => {
    if (ytMode) { updateYtProgress(); return; }
    if (!spPlayer || !currentIsSpotify()) return;
    try {
      const s = await spPlayer.getCurrentState();
      if (s) {
        spPosition = s.position; spDuration = s.duration;
        const was = spPlaying; spPlaying = !s.paused;
        if (was !== spPlaying) syncPlayBtn();
        updateSpotifyProgress();
      }
    } catch (e) { /* transient */ }
  }, 1000);
}

function waitFor(fn, ms) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    (function poll() { if (fn()) return res(fn()); if (Date.now() - t0 > ms) return rej(new Error('timed out waiting for Spotify')); setTimeout(poll, 250); })();
  });
}

async function spPlayUri(uri) {
  const token = await getValidToken();
  const res = await fetch(`${SP_API}/me/player/play?device_id=${spDeviceId}`, {
    method: 'PUT',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris: [uri] })
  });
  if (res.status === 403) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || 'forbidden — Spotify Premium is required'); }
  if (!res.ok && res.status !== 204) { const e = await res.json().catch(() => ({})); throw new Error(e.error?.message || ('play failed: ' + res.status)); }
}

/* ----- Free fallback: Spotify tracks play through YouTube when the account isn't Premium -----
   Spotify login still provides the library (playlists, liked songs, search). Only the audio
   transport switches: a hidden YouTube IFrame player streams the matched video's audio. */
let ytApiReady = null, ytApiLoading = null, ytPlayer = null, ytMode = false, ytPlaying = false, ytNoticeShown = false;
let ytStallTimer = null, ytStalled = false, ytTickTimer = null;
const ytVideoCache = {};

/* Load the YouTube IFrame API early (idle time after boot) so that when the user
   taps Play, player creation + loadVideoById happen inside the browser's
   user-activation window and autoplay with sound is allowed. */
function ensureYtApi() {
  if (ytApiReady) return ytApiReady;
  ytApiReady = new Promise((res, rej) => {
    if (window.YT && window.YT.Player) return res();
    const to = setTimeout(() => rej(new Error('YouTube player timed out — check your connection')), 20000);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(to);
      try { if (typeof prev === 'function') prev(); } catch (e) {}
      res();
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { clearTimeout(to); rej(new Error('Could not load the YouTube player')); };
    document.head.appendChild(s);
  });
  ytApiReady.catch(() => { ytApiReady = null; });
  return ytApiReady;
}

function ensureYtPlayer() {
  if (ytApiLoading) return ytApiLoading;
  const p = ensureYtApi().then(() => new Promise((res, rej) => {
    // Reuse a working player; rebuild if a previous attempt left a broken one
    // (e.g. an adblocker-supplied stub without real player methods).
    if (ytPlayer && typeof ytPlayer.loadVideoById === 'function') return res();
    ytPlayer = null;
    const div = document.createElement('div');
    div.id = 'yt-audio-hidden';
    div.style.cssText = 'position:fixed;left:-10px;top:-10px;width:4px;height:4px;opacity:0;pointer-events:none;';
    document.body.appendChild(div);
    const to = setTimeout(() => { ytPlayer = null; rej(new Error('YouTube player did not start — it may be blocked by an adblocker or extension')); }, 15000);
    try {
      ytPlayer = new YT.Player(div, {
        width: '4', height: '4',
        playerVars: { rel: 0 },
        events: {
          onReady: () => {
            if (!ytPlayer || typeof ytPlayer.loadVideoById !== 'function') {
              clearTimeout(to); ytPlayer = null;
              rej(new Error('YouTube player failed to initialize — it may be blocked by an adblocker or extension'));
              return;
            }
            clearTimeout(to);
            try { ytPlayer.setVolume(+($('#volume')?.value || 80)); } catch (e) {}
            res();
          },
          onStateChange: onYtState,
          onError: () => { if (ytMode) { spNotice('YouTube could not play this track — skipping.'); step(1); } }
        }
      });
    } catch (e) {
      clearTimeout(to); ytPlayer = null;
      rej(new Error('Could not create the YouTube player'));
    }
  }));
  ytApiLoading = p;
  // Let later attempts retry instead of reusing a failed promise.
  p.catch(() => { if (ytApiLoading === p) ytApiLoading = null; });
  return ytApiLoading;
}

function onYtState(e) {
  if (!ytMode || !window.YT) return;
  ytPlaying = e.data === YT.PlayerState.PLAYING;
  if (e.data === YT.PlayerState.ENDED) {
    if (repeatMode === 'one') replayCurrentYt();
    else step(1);
  }
  syncPlayBtn();
}

function replayCurrentYt() {
  const t = currentTrack();
  if (!t) return;
  if (t.ytId) playYtAudioTrack(t, t.ytId);
  else playSpotifyViaYouTube(t);
}

function stopYt() {
  ytMode = false; ytPlaying = false;
  disarmYtStall();
  disarmAdSilencer();
  clearInterval(ytTickTimer); ytTickTimer = null;
  try { if (ytPlayer && ytPlayer.pauseVideo) ytPlayer.pauseVideo(); } catch (e) {}
}

function updateYtProgress() {
  if (!ytMode || !ytPlayer) return;
  try {
    const pos = ytPlayer.getCurrentTime() || 0, dur = ytPlayer.getDuration() || 0;
    adSilencerTick(dur);
    if (dur > 0) { // main video (not an ad) — trust the numbers
      if (pos > 0.5) disarmYtStall();
      $('#t-cur').textContent = fmt(pos);
      $('#t-dur').textContent = fmt(dur);
      if (!seeking) $('#seek').value = Math.round(pos / dur * 1000);
    }
  } catch (e) { /* transient */ }
}

/* Stall watchdog: pre-roll ads report position 0 and no usable duration, so only
   trust progress once the main video's metadata (duration) is available. If the
   video never gets going, first try an automatic kick, then ask for a tap. */
let ytPromptShown = false;
function armYtStallWatchdog() {
  clearInterval(ytStallTimer);
  const t0 = Date.now();
  let autoTried = false;
  ytStallTimer = setInterval(() => {
    if (!ytMode) { clearInterval(ytStallTimer); ytStallTimer = null; return; }
    let pos = 0, dur = 0;
    try { pos = ytPlayer.getCurrentTime() || 0; dur = ytPlayer.getDuration() || 0; } catch (e) {}
    const elapsed = (Date.now() - t0) / 1000;
    if (dur > 0 && pos > 0.5) { disarmYtStall(); return; }
    const stuck = elapsed > 25 || (dur > 0 && elapsed > 12);
    if (!stuck) return;
    if (!autoTried) {
      autoTried = true;
      try { ytPlayer.seekTo(0, true); ytPlayer.playVideo(); } catch (e) {}
      return;
    }
    clearInterval(ytStallTimer); ytStallTimer = null;
    ytStalled = true;
    $('#play')?.classList.add('stalled');
    ytPromptShown = true;
    toast('Tap Play to start the audio.', true);
  }, 2000);
}
function disarmYtStall() {
  clearInterval(ytStallTimer); ytStallTimer = null;
  ytStalled = false;
  $('#play')?.classList.remove('stalled');
  if (ytPromptShown) { ytPromptShown = false; toast(); }
}

/* ---------------- Ad Silencer: one-click YouTube ad muting ----------------
   YouTube serves ads inside its own embedded player, which a website cannot
   block or skip (cross-origin iframe — the browser deliberately withholds
   those powers from pages). But Tunebox plays audio-only, so muting an ad is
   equivalent to removing it: the ad still plays, you just don't hear it.
   Detection: during ads getDuration() reports the ad's own length (or 0 for
   pre-rolls) instead of the song's length, which we know from track metadata
   (t.duration) or learn from the first stable reading. One click toggles it;
   the choice persists in localStorage. */
let adSilVideo = null, adSilMuted = false, adSilUserMuted = false,
    adSilLearned = 0, adSilExpected = 0, adSilT0 = 0, adSilSeekTried = false;
const adSilencerOn = () => { try { return localStorage.getItem('tunebox_adsil') !== '0'; } catch (e) { return true; } };
function adSilencerSet(on) { try { localStorage.setItem('tunebox_adsil', on ? '1' : '0'); } catch (e) {} }
function syncMuteIcon() { try { if (ytPlayer) $('#mute').innerHTML = ytPlayer.isMuted() ? '&#128263;' : '&#128266;'; } catch (e) {} }

function armAdSilencer(t) {
  disarmAdSilencer();
  adSilVideo = (t && (t.ytId || t.id)) || 'yt';
  adSilLearned = 0; adSilT0 = Date.now(); adSilSeekTried = false;
  adSilExpected = (t && t.duration) || 0; // seconds, when the track metadata has it
}
function disarmAdSilencer() {
  if (adSilMuted && ytPlayer) { try { if (!adSilUserMuted) ytPlayer.unMute(); } catch (e) {} }
  adSilMuted = false; adSilVideo = null;
  document.body.classList.remove('ad-silenced');
}
function adSilencerTick(dur) {
  if (!ytMode || !ytPlayer) return;
  if (!adSilencerOn()) { if (adSilMuted) disarmAdSilencer(); return; }
  if (dur > adSilLearned) adSilLearned = dur;
  const ref = adSilExpected > 45 ? adSilExpected : adSilLearned;
  let ad = false;
  if (ref > 45 && dur > 0 && dur < ref * 0.6) ad = true; // ad reporting its own (short) length
  else if (ref > 45 && dur === 0 && (Date.now() - adSilT0) > 4000) { // pre-roll: no usable duration yet
    try { const st = ytPlayer.getPlayerState(); if (st === 1 || st === 3) ad = true; } catch (e) {}
  }
  if (ad && !adSilMuted) {
    try { adSilUserMuted = ytPlayer.isMuted(); ytPlayer.mute(); } catch (e) {}
    adSilMuted = true; adSilSeekTried = false;
    document.body.classList.add('ad-silenced');
    syncMuteIcon();
  }
  if (ad && adSilMuted && !adSilSeekTried && dur > 0) {
    // Best-effort: ask the player to jump past the ad. YouTube usually refuses
    // seeks inside ads (the mute above is the real fallback); when it doesn't,
    // the ad is gone instead of just silent.
    adSilSeekTried = true;
    try { ytPlayer.seekTo(dur, true); } catch (e) {}
  }
  if (!ad && adSilMuted) {
    adSilMuted = false;
    try { if (!adSilUserMuted) ytPlayer.unMute(); } catch (e) {}
    document.body.classList.remove('ad-silenced');
    syncMuteIcon();
  }
}

async function playYtAudioTrack(t, vid) {
  ytMode = true; ytStalled = false;
  if (spPlayer && spPlaying) spPlayer.pause().catch(() => {});
  spPlaying = false;
  audio.pause();
  try {
    await ensureYtPlayer();
    ytPlayer.loadVideoById(vid);
    clearInterval(ytTickTimer);
    ytTickTimer = setInterval(updateYtProgress, 500);
    armYtStallWatchdog();
    armAdSilencer(t);
  } catch (e) {
    ytMode = false;
    clearInterval(ytTickTimer); ytTickTimer = null;
    spNotice('Could not play via YouTube: ' + (e.message || e));
  }
  syncPlayerUI();
}

async function playSpotifyViaYouTube(t) {
  try {
    let vid = ytVideoCache[t.id];
    if (!vid) {
      const res = await fetch(backendUrl() + '/api/yt/search?' + new URLSearchParams({ q: `${t.title} ${t.artist} audio` }));
      if (!res.ok) throw new Error('music search is unreachable right now');
      const items = await res.json();
      if (!items.length) throw new Error('no match found on YouTube');
      vid = items[0].id;
      ytVideoCache[t.id] = vid;
    }
    await playYtAudioTrack(t, vid);
    if (!ytNoticeShown) { ytNoticeShown = true; toast('No Spotify Premium — playing your Spotify tracks free via YouTube.'); }
  } catch (e) {
    spNotice('Could not play via YouTube: ' + (e.message || e));
  }
  syncPlayerUI();
}

function onSpotifyState(state) {
  if (!state) { spPlaying = false; syncPlayBtn(); return; }
  const was = spPlaying;
  spPlaying = !state.paused;
  spPosition = state.position; spDuration = state.duration;
  if (was && state.paused && state.duration > 10000 && state.position >= state.duration - 1500) onSpotifyEnded();
  if (currentIsSpotify()) { syncPlayBtn(); updateSpotifyProgress(); }
}
function onSpotifyEnded() {
  if (repeatMode === 'one') { const t = currentTrack(); if (t?.spotifyUri) spPlayUri(t.spotifyUri).catch(e => spNotice(e.message)); }
  else step(1);
}
function updateSpotifyProgress() {
  if (!currentIsSpotify()) return;
  $('#t-cur').textContent = fmt(spPosition / 1000);
  $('#t-dur').textContent = fmt(spDuration / 1000);
  if (!seeking && spDuration) $('#seek').value = Math.round(spPosition / spDuration * 1000);
}
function spNotice(msg) { toast(msg); }

/* ----- normalize Spotify objects into Tunebox tracks ----- */
function hashHue(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
function spTrack(item, fallbackImg) {
  const id = 'sp:' + item.uri;
  if (!spotifyTrackCache[id]) {
    spotifyTrackCache[id] = {
      id, source: 'spotify', spotifyUri: item.uri,
      title: item.name || 'Unknown title',
      artist: (item.artists || []).map(a => a.name).join(', ') || 'Unknown artist',
      album: item.album?.name || '',
      duration: Math.round((item.duration_ms || 0) / 1000),
      image: item.album?.images?.[1]?.url || item.album?.images?.[0]?.url || fallbackImg || '',
      hue: hashHue(item.uri)
    };
  }
  return spotifyTrackCache[id];
}

/* ----- Spotify view ----- */
function spSetupHTML() {
  return `<div class="greeting">Connect Spotify</div>
  <div class="sp-panel">
    <p>Connect your Spotify to browse your playlists, liked songs and the catalog inside Tunebox. <b>Premium</b> unlocks Spotify's native player; without it, tracks play free through YouTube.</p>
    <ol class="sp-steps">
      <li>Open <b>developer.spotify.com/dashboard</b> and log in with your Spotify account.</li>
      <li>Click <b>Create app</b>, give it any name, then open <b>Settings</b>.</li>
      <li>Open the app at <code>http://127.0.0.1:8000</code> (Spotify doesn't accept the <code>localhost</code> name).</li>
      <li>The Tunebox app is already set up — press <b>Save</b> below, then connect your Spotify account.</li>
    </ol>
    <div class="sp-row">
      <input id="sp-client-id" class="sp-input" placeholder="Spotify Client ID" value="${esc(getClientId())}" autocomplete="off">
      <button id="sp-save-id" class="sp-btn">Save</button>
    </div>
    ${spAuthError ? `<div class="sp-notice err">${esc(spAuthError)}</div>` : ''}
  </div>`;
}
function spConnectHTML() {
  return `<div class="greeting">Spotify</div>
  <div class="sp-panel">
    <p>Your Client ID is saved. Connect your Spotify account to browse and play the full catalog inside Tunebox.</p>
    <p class="sp-note"><b>Premium</b> enables Spotify's native in-app player. Without Premium, your Spotify tracks play free via YouTube — everything else works the same.</p>
    <p class="sp-note">If Spotify shows <b>"Access denied"</b> after you log in, the Tunebox app is still in development mode — its owner needs to add your Spotify email under Users and Access in the Spotify dashboard. Nothing is broken on your end.</p>
    <div class="sp-row"><button id="sp-connect" class="sp-btn big">Connect Spotify</button></div>
    ${spAuthError ? `<div class="sp-notice err">${esc(spAuthError)}</div>` : ''}
    <div class="sp-row"><button id="sp-change-id" class="ghost-btn">Use a different Client ID</button></div>
  </div>`;
}
function bindSetup() {
  $('#sp-save-id').addEventListener('click', () => {
    const v = $('#sp-client-id').value.trim();
    if (!v) { spNotice('Paste your Client ID first.'); return; }
    localStorage.setItem(LS_SP_ID, v);
    renderSpotify();
  });
}
function bindConnect() {
  $('#sp-connect').addEventListener('click', startSpotifyAuth);
  const ch = $('#sp-change-id');
  if (ch) ch.addEventListener('click', () => { localStorage.removeItem(LS_SP_ID); renderSpotify(); });
}

async function renderSpotify() {
  if (!getClientId()) { $('#view').innerHTML = spSetupHTML(); bindSetup(); return; }
  if (!hasTokens()) { $('#view').innerHTML = spConnectHTML(); bindConnect(); return; }
  const st = spViewState;
  $('#view').innerHTML = `
    <div class="sp-head">
      <div class="greeting" style="margin:0">Spotify</div>
      <div class="spacer"></div>
      <span class="sp-user" id="sp-user">${spProfile ? esc(spProfile.display_name || spProfile.email || '') : ''}</span>
      <button id="sp-disconnect" class="ghost-btn">Disconnect</button>
    </div>
    ${spPremium ? '' : `<div class="sp-notice">No Spotify Premium on this account — your Spotify playlists, liked songs and search all work, and tracks play free through YouTube. Tap any track to play.</div>`}
    <div class="sp-tabs">
      <button class="sp-tab ${st.tab === 'playlists' && !st.playlistId ? 'on' : ''}" data-sptab="playlists">Playlists</button>
      <button class="sp-tab ${st.tab === 'liked' ? 'on' : ''}" data-sptab="liked">Liked Songs</button>
      <button class="sp-tab ${st.tab === 'all' ? 'on' : ''}" data-sptab="all">All Songs</button>
      <button class="sp-tab ${st.tab === 'search' ? 'on' : ''}" data-sptab="search">Search</button>
    </div>
    <div id="sp-content">${skelTracks(8)}</div>`;
  document.querySelectorAll('[data-sptab]').forEach(b => b.addEventListener('click', () => {
    spViewState = { tab: b.dataset.sptab, playlistId: null, query: spViewState.query, likedOffset: 0, likedIds: [], allIds: [] };
    renderSpotify();
  }));
  $('#sp-disconnect').addEventListener('click', disconnectSpotify);
  loadSpProfile();
  ensureSpotifyPlayer().catch(e => spNotice('Spotify player: ' + e.message));
  try {
    if (st.tab === 'playlists' && !st.playlistId) await renderSpPlaylists();
    else if (st.tab === 'playlists') await renderSpPlaylistDetail(st.playlistId);
    else if (st.tab === 'liked') await renderSpLiked();
    else if (st.tab === 'all') await renderSpAll();
    else await renderSpSearch();
  } catch (e) {
    const c = $('#sp-content');
    if (c) c.innerHTML = `<div class="sp-notice err">${esc(e.message)}</div>`;
  }
}

async function loadSpProfile() {
  if (spProfile) return spProfile;
  try {
    spProfile = await spApi('/v1/me');
    spPremium = spProfile.product === 'premium';
    const el = $('#sp-user');
    if (el) el.textContent = spProfile.display_name || spProfile.email || '';
    if (!spPremium && currentView.name === 'spotify') renderSpotify();
  } catch (e) { /* offline / expired — handled on next action */ }
  return spProfile;
}

async function renderSpPlaylists() {
  const data = await spApi('/v1/me/playlists?limit=50');
  const pls = data.items || [];
  $('#sp-content').innerHTML = pls.length ? `<div class="card-grid">` + pls.map(p => {
    const hue = hashHue(p.id || p.name);
    return `
    <button class="card" data-sppl="${p.id}">
      ${p.images?.[0]?.url ? `<img class="c-cover" src="${p.images[0].url}" data-poster="${posterURL(p.name, hueFor(p.id))}" alt="">` : `<div class="c-cover" style="background:linear-gradient(135deg,hsl(${hue},70%,45%),hsl(${(hue + 50) % 360},75%,28%))"></div>`}
      <div class="c-title">${esc(p.name)}</div><div class="c-sub">${p.tracks.total} songs</div>
    </button>`;
  }).join('') + `</div>` : `<div class="empty">No playlists found on your Spotify account.</div>`;
  document.querySelectorAll('[data-sppl]').forEach(b => b.addEventListener('click', () => {
    spViewState = { ...spViewState, tab: 'playlists', playlistId: b.dataset.sppl };
    renderSpotify();
  }));
}

async function renderSpPlaylistDetail(id) {
  const data = await spApi(`/v1/playlists/${id}?fields=name,description,images,tracks.items(track(uri,name,artists,duration_ms,album(name,images)))`);
  const tracks = (data.tracks?.items || []).map(x => x.track).filter(t => t && t.uri);
  const ids = tracks.map(t => spTrack(t).id);
  const img = data.images?.[0]?.url || '';
  $('#sp-content').innerHTML = `
    <button class="ghost-btn" id="sp-back">← Back to playlists</button>
    <div class="pl-header">
      ${img ? `<img class="pl-big-cover" src="${img}" data-poster="${posterURL(data.name || name, hueFor(data.name || name))}" alt="">` : posterImg(data.name || name, hueFor(data.name || name), 'pl-big-cover')}
      <div><div class="pl-type">Spotify Playlist</div>
        <div class="pl-title-big">${esc(data.name)}</div>
        <div class="pl-meta">${esc((data.description || '').replace(/<[^>]*>/g, ''))} • ${tracks.length} songs</div></div>
    </div>
    <div class="pl-actions"><button class="big-play" id="sp-pl-play">&#9654;</button></div>
    ${trackTable(ids)}`;
  $('#sp-back').addEventListener('click', () => { spViewState = { ...spViewState, tab: 'playlists', playlistId: null }; renderSpotify(); });
  $('#sp-pl-play').addEventListener('click', () => { if (ids.length) { setQueue(ids, 0); playCurrent(); } });
  bindTrackRows(ids);
}

async function renderSpLiked() {
  const data = await spApi(`/v1/me/tracks?limit=50&offset=${spViewState.likedOffset}`);
  const tracks = (data.items || []).map(x => x.track).filter(t => t && t.uri);
  spViewState.likedIds = [...spViewState.likedIds, ...tracks.map(t => spTrack(t).id)];
  const all = spViewState.likedIds;
  $('#sp-content').innerHTML = `<div class="section-title">Liked Songs</div>` + trackTable(all) +
    (data.next ? `<div style="text-align:center;padding:18px"><button class="ghost-btn" id="sp-more">Load more</button></div>` : '');
  const m = $('#sp-more');
  if (m) m.addEventListener('click', () => { spViewState.likedOffset += 50; renderSpLiked(); });
  bindTrackRows(all);
}

/* ----- All Songs: every track from liked songs + all playlists, deduplicated ----- */
async function spGetAll(path) {
  let url = path, items = [];
  while (url) {
    const data = await spApi(url);
    items.push(...(data.items || []));
    url = data.next || null;
    if (items.length > 5000) break;
  }
  return items;
}

async function renderSpAll() {
  if (spViewState.allIds.length) { renderSpAllList(); return; }
  const c = $('#sp-content');
  c.innerHTML = `<div class="empty" id="sp-all-status">Loading your library…</div>`;
  const say = msg => { const el = $('#sp-all-status'); if (el) el.textContent = msg; };
  const seen = new Set(), ids = [];
  const add = t => {
    if (!t || !t.uri || seen.has(t.uri)) return;
    seen.add(t.uri); ids.push(spTrack(t).id);
  };
  try {
    // 1) liked songs
    let url = '/v1/me/tracks?limit=50';
    while (url) {
      const d = await spApi(url);
      (d.items || []).forEach(x => add(x.track));
      url = d.next || null;
      say(`Loading your library… ${ids.length} songs so far`);
    }
    // 2) every playlist's tracks
    const pls = await spGetAll('/v1/me/playlists?limit=50');
    let n = 0;
    for (const p of pls) {
      n++;
      let turl = `/v1/playlists/${p.id}/tracks?limit=100&fields=items(track(uri,name,artists,duration_ms,album(name,images))),next`;
      while (turl) {
        const d = await spApi(turl);
        (d.items || []).forEach(x => add(x.track));
        turl = d.next || null;
      }
      say(`Loading your library… ${n}/${pls.length} playlists • ${ids.length} songs`);
      if (ids.length > 5000) break;
    }
    spViewState.allIds = ids;
  } catch (e) {
    say(''); c.innerHTML = `<div class="sp-notice err">${esc(e.message)}</div>`;
    return;
  }
  renderSpAllList();
}

function renderSpAllList() {
  const ids = spViewState.allIds;
  $('#sp-content').innerHTML = `
    <div class="section-title">All Songs (${ids.length})</div>
    <div class="pl-actions">
      <button class="big-play" id="sp-all-play">&#9654;</button>
      <button class="ghost-btn" id="sp-all-refresh">Refresh</button>
    </div>
    ${ids.length ? trackTable(ids) : `<div class="empty">No songs found in your Spotify library yet.</div>`}`;
  const pp = $('#sp-all-play');
  if (pp) pp.addEventListener('click', () => { if (ids.length) { setQueue(ids, 0); playCurrent(); } });
  const rf = $('#sp-all-refresh');
  if (rf) rf.addEventListener('click', () => { spViewState.allIds = []; renderSpAll(); });
  bindTrackRows(ids);
}

async function renderSpSearch() {
  const q = spViewState.query || '';
  $('#sp-content').innerHTML = `
    <input id="sp-search" class="sp-input" placeholder="Search Spotify: songs, albums, playlists…" value="${esc(q)}" autocomplete="off">
    <div id="sp-results" style="margin-top:18px">${q ? `<div class="empty">Searching…</div>` : ''}</div>`;
  const inp = $('#sp-search');
  let timer;
  inp.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { spViewState.query = inp.value; doSpSearch(); }, 400); });
  inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length);
  if (q) doSpSearch();
}
async function doSpSearch() {
  const q = (spViewState.query || '').trim();
  const box = $('#sp-results');
  if (!box) return;
  if (!q) { box.innerHTML = ''; return; }
  try {
    const data = await spApi('/v1/search?' + new URLSearchParams({ q, type: 'track,album,playlist', limit: '10' }));
    const tracks = (data.tracks?.items || []).filter(t => t?.uri);
    const trackIds = tracks.map(t => spTrack(t).id);
    const albums = (data.albums?.items || []).filter(a => a?.id);
    const pls = (data.playlists?.items || []).filter(p => p?.id);
    let html = '';
    if (trackIds.length) html += `<div class="section-title">Tracks</div>` + trackTable(trackIds);
    if (albums.length || pls.length) {
      html += `<div class="section-title">Albums & Playlists</div><div class="card-grid">`;
      html += albums.map(a => `
        <button class="card" data-spalb="${a.id}" data-spimg="${a.images?.[0]?.url || ''}">
          ${a.images?.[0]?.url ? `<img class="c-cover" src="${a.images[0].url}" data-poster="${posterURL(a.name, hueFor(a.name))}" alt="">` : posterImg(a.name, hueFor(a.name), 'c-cover')}
          <div class="c-title">${esc(a.name)}</div><div class="c-sub">Album • ${esc((a.artists || []).map(x => x.name).join(', '))}</div>
        </button>`).join('');
      html += pls.map(p => `
        <button class="card" data-sppl="${p.id}">
          ${p.images?.[0]?.url ? `<img class="c-cover" src="${p.images[0].url}" data-poster="${posterURL(p.name, hueFor(p.id))}" alt="">` : posterImg(p.name, hueFor(p.name), 'c-cover')}
          <div class="c-title">${esc(p.name)}</div><div class="c-sub">Playlist</div>
        </button>`).join('');
      html += `</div>`;
    }
    if (!html) html = `<div class="empty">No results for "${esc(q)}".</div>`;
    box.innerHTML = html;
    bindTrackRows(trackIds);
    box.querySelectorAll('[data-spalb]').forEach(b => b.addEventListener('click', () =>
      renderSpAlbum(b.dataset.spalb, b.dataset.spimg, b.querySelector('.c-title').textContent)));
    box.querySelectorAll('[data-sppl]').forEach(b => b.addEventListener('click', () => {
      spViewState = { ...spViewState, tab: 'playlists', playlistId: b.dataset.sppl };
      renderSpotify();
    }));
  } catch (e) { box.innerHTML = `<div class="sp-notice err">${esc(e.message)}</div>`; }
}
async function renderSpAlbum(id, img, name) {
  const data = await spApi(`/v1/albums/${id}?fields=name,artists,tracks.items(uri,name,artists,duration_ms)`);
  const tracks = (data.tracks?.items || []).filter(t => t?.uri);
  const ids = tracks.map(t => spTrack({ ...t, album: { name: data.name, images: img ? [{ url: img }] : [] } }, img).id);
  $('#sp-content').innerHTML = `
    <button class="ghost-btn" id="sp-back">← Back to search</button>
    <div class="pl-header">
      ${img ? `<img class="pl-big-cover" src="${img}" data-poster="${posterURL(data.name || name, hueFor(data.name || name))}" alt="">` : posterImg(data.name || name, hueFor(data.name || name), 'pl-big-cover')}
      <div><div class="pl-type">Spotify Album</div>
        <div class="pl-title-big">${esc(data.name || name)}</div>
        <div class="pl-meta">${esc((data.artists || []).map(a => a.name).join(', '))} • ${tracks.length} songs</div></div>
    </div>
    <div class="pl-actions"><button class="big-play" id="sp-pl-play">&#9654;</button></div>
    ${trackTable(ids)}`;
  $('#sp-back').addEventListener('click', () => { spViewState = { ...spViewState, tab: 'search' }; renderSpotify(); });
  $('#sp-pl-play').addEventListener('click', () => { if (ids.length) { setQueue(ids, 0); playCurrent(); } });
  bindTrackRows(ids);
}

/* ---------------- Free music: Audius catalog, no account or payment needed ---------------- */
const AU_API = 'https://discoveryprovider.audius.co/v1';
const AU_APP = 'tunebox';
const AU_CACHE_LS = 'tunebox.audius';
const audiusTrackCache = {};
const AU_GENRES = ['Electronic', 'Hip-Hop/Rap', 'Pop', 'Rock', 'R&B/Soul', 'Alternative', 'Ambient', 'Techno', 'House'];
let auGenre = '', auQuery = '';

async function auApi(path) {
  const res = await fetch(AU_API + path + (path.includes('?') ? '&' : '?') + 'app_name=' + AU_APP);
  if (!res.ok) throw new Error('free music service error (' + res.status + ')');
  const json = await res.json();
  return json.data || [];
}
function auTrack(item) {
  const id = 'au:' + item.id;
  if (!audiusTrackCache[id]) {
    audiusTrackCache[id] = {
      id, source: 'audius',
      title: item.title || 'Unknown title',
      artist: item.user?.name || 'Unknown artist',
      album: '',
      duration: Math.round(item.duration || 0),
      genre: item.genre || '',
      image: item.artwork?.['480x480'] || item.artwork?.['150x150'] || '',
      src: `${AU_API}/tracks/${item.id}/stream?app_name=${AU_APP}`,
      hue: hashHue(String(item.id))
    };
    persistAuCache();
  }
  return audiusTrackCache[id];
}
function persistAuCache() {
  try {
    localStorage.setItem(AU_CACHE_LS, JSON.stringify(Object.values(audiusTrackCache).slice(-500)));
  } catch (e) { /* storage full — memory cache still works for this session */ }
}
function loadAuCache() {
  try {
    JSON.parse(localStorage.getItem(AU_CACHE_LS) || '[]').forEach(t => { audiusTrackCache[t.id] = t; });
  } catch (e) { /* fresh start */ }
}

let freeSource = 'audius'; // 'audius' | 'archive' | 'youtube'

async function renderFree() {
  $('#view').innerHTML = `
    <div class="greeting">Free Music</div>
    <p class="sp-note">Free streaming, no account or payment needed — independent artists (Audius), live concerts & classic recordings (Internet Archive), and YouTube's official player.</p>
    <div class="sp-tabs">
      <button class="sp-tab ${freeSource === 'audius' ? 'on' : ''}" data-fsrc="audius">Audius</button>
      <button class="sp-tab ${freeSource === 'archive' ? 'on' : ''}" data-fsrc="archive">Archive</button>
      <button class="sp-tab ${freeSource === 'youtube' ? 'on' : ''}" data-fsrc="youtube">YouTube</button>
    </div>
    <div id="free-body"><div class="empty">Loading…</div></div>`;
  document.querySelectorAll('[data-fsrc]').forEach(b => b.addEventListener('click', () => { freeSource = b.dataset.fsrc; renderFree(); }));
  if (freeSource === 'audius') await renderFreeAudius();
  else if (freeSource === 'youtube') renderFreeYouTube();
  else await renderFreeArchive();
}

async function renderFreeAudius() {
  $('#free-body').innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px">
      <button class="ghost-btn au-genre ${!auGenre ? 'on' : ''}" data-g="">All</button>
      ${AU_GENRES.map(g => `<button class="ghost-btn au-genre ${auGenre === g ? 'on' : ''}" data-g="${esc(g)}">${esc(g)}</button>`).join('')}
    </div>
    <div class="uni-hint">Tip: the search bar at the top searches Audius along with Spotify, YouTube and the Archive. Hit the &#8681; button on any track to save it as an audio file, free.</div>
    <div id="au-content"><div class="empty">Loading…</div></div>`;
  document.querySelectorAll('.au-genre').forEach(b => b.addEventListener('click', () => {
    auGenre = b.dataset.g; renderFree();
  }));
  await loadAuTracks();
}

async function loadAuTracks() {
  const box = $('#au-content');
  if (!box) return;
  box.innerHTML = skelTracks(8);
  try {
    const q = auQuery.trim();
    const items = q
      ? await auApi('/tracks/search?query=' + encodeURIComponent(q) + '&limit=50')
      : await auApi('/tracks/trending?limit=50' + (auGenre ? '&genre=' + encodeURIComponent(auGenre) : ''));
    const ids = items.filter(t => t && t.id && t.is_streamable !== false).map(t => auTrack(t).id);
    box.innerHTML = `<div class="section-title">${q ? `Results for "${esc(q)}"` : (auGenre ? esc(auGenre) : 'Trending now')}</div>` +
      (ids.length
        ? `<div class="pl-actions"><button class="big-play" id="au-play">&#9654;</button></div>` + trackTable(ids)
        : `<div class="empty">No tracks found — try another search.</div>`);
    const pp = $('#au-play');
    if (pp) pp.addEventListener('click', () => { setQueue(ids, 0); playCurrent(); });
    bindTrackRows(ids);
  } catch (e) {
    box.innerHTML = `<div class="sp-notice err">Couldn't load free music (${esc(e.message)}). Check your connection and try again.</div>`;
  }
}

/* ---------------- Free music source 2: Internet Archive (live concerts, classics) ---------------- */
const IA_CACHE_LS = 'tunebox.archive';
const archiveTrackCache = {};
let iaQuery = '', iaItemId = null;

function hashStr(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); }
function iaFileTitle(name) {
  const base = name.split('/').pop().replace(/\.(mp3|ogg|flac|m4a|wav)$/i, '');
  return (base.replace(/^\d+[-._\s]+/, '').replace(/_/g, ' ').trim()) || base;
}
function iaLengthSecs(len) {
  if (len == null) return 0;
  const s = String(len).trim();
  if (s.includes(':')) {
    const p = s.split(':').map(Number);
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + (p[1] || 0);
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.round(n);
}
function persistIaCache() {
  try {
    localStorage.setItem(IA_CACHE_LS, JSON.stringify(Object.values(archiveTrackCache).slice(-500)));
  } catch (e) { /* storage full — memory cache still works for this session */ }
}
function loadIaCache() {
  try {
    JSON.parse(localStorage.getItem(IA_CACHE_LS) || '[]').forEach(t => { archiveTrackCache[t.id] = t; });
  } catch (e) { /* fresh start */ }
}

async function iaSearch(query) {
  const q = query.trim() ? `mediatype:audio AND (${query.trim()})` : 'collection:etree AND mediatype:audio';
  const sp = new URLSearchParams();
  sp.set('q', q);
  ['identifier', 'title', 'creator', 'year'].forEach(f => sp.append('fl[]', f));
  sp.set('rows', '24');
  sp.set('output', 'json');
  if (!query.trim()) sp.append('sort[]', 'downloads desc');
  const res = await fetch('https://archive.org/advancedsearch.php?' + sp.toString());
  if (!res.ok) throw new Error('archive.org error (' + res.status + ')');
  const json = await res.json();
  return json.response?.docs || [];
}

async function iaLoadItem(id) {
  const res = await fetch('https://archive.org/metadata/' + encodeURIComponent(id));
  if (!res.ok) throw new Error('could not load item');
  const meta = await res.json();
  const md = meta.metadata || {};
  const files = (meta.files || []).filter(f => {
    const n = (f.name || '').toLowerCase();
    return (n.endsWith('.mp3') || n.endsWith('.ogg') || n.endsWith('.flac')) && !n.includes('spectrogram');
  });
  const seen = new Set(), picks = [];
  for (const ext of ['.mp3', '.ogg', '.flac'])
    for (const f of files.filter(f => f.name.toLowerCase().endsWith(ext))) {
      const key = iaFileTitle(f.name).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key); picks.push(f);
    }
  picks.sort((a, b) => a.name.localeCompare(b.name));
  const ids = picks.map(f => {
    const tid = 'ia:' + id + ':' + hashStr(f.name);
    if (!archiveTrackCache[tid]) {
      archiveTrackCache[tid] = {
        id: tid, source: 'archive',
        title: iaFileTitle(f.name),
        artist: md.creator || 'Unknown artist',
        album: md.title || '',
        duration: iaLengthSecs(f.length),
        image: 'https://archive.org/services/img/' + id,
        src: 'https://archive.org/download/' + id + '/' + f.name.split('/').map(encodeURIComponent).join('/'),
        hue: hashHue(f.name)
      };
    }
    return tid;
  });
  persistIaCache();
  return { title: md.title || id, creator: md.creator || '', ids };
}

async function renderFreeArchive() {
  if (iaItemId) { await renderIaDetail(); return; }
  $('#free-body').innerHTML = `
    <div class="uni-hint">Tip: the search bar at the top searches the Archive along with Spotify, YouTube and Audius. Hit the &#8681; button on any track to save it as an audio file, free.</div>
    <div id="ia-content"></div>`;
  await loadIaResults();
}

async function loadIaResults() {
  const box = $('#ia-content');
  if (!box) return;
  box.innerHTML = skelRow(6, iaQuery.trim() ? `Results for "${esc(iaQuery.trim())}"` : 'Popular live recordings');
  try {
    const docs = await iaSearch(iaQuery);
    if (!docs.length) { box.innerHTML = `<div class="empty">No results — try another search.</div>`; return; }
    box.innerHTML = `<div class="section-title">${iaQuery.trim() ? `Results for "${esc(iaQuery.trim())}"` : 'Popular live recordings'}</div><div class="card-grid">` +
      docs.map(d => {
        const poster = posterURL(d.title || d.identifier, hueFor(d.identifier));
        return `
        <button class="card" data-iaid="${esc(d.identifier)}">
          <img class="c-cover" src="https://archive.org/services/img/${esc(d.identifier)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${poster}'">
          <div class="c-title">${esc(d.title || d.identifier)}</div>
          <div class="c-sub">${esc(d.creator || '')}${d.year ? ' • ' + esc(d.year) : ''}</div>
        </button>`; }).join('') + `</div>`;
    box.querySelectorAll('[data-iaid]').forEach(b => b.addEventListener('click', () => { iaItemId = b.dataset.iaid; renderFree(); }));
  } catch (e) {
    box.innerHTML = `<div class="sp-notice err">Couldn't reach archive.org (${esc(e.message)}). Check your connection and try again.</div>`;
  }
}

async function renderIaDetail() {
  const body = $('#free-body');
  const back = `<div style="margin-top:12px"><button class="ghost-btn" id="ia-back">← Back to results</button></div>`;
  body.innerHTML = skelTracks(8);
  try {
    const { title, creator, ids } = await iaLoadItem(iaItemId);
    body.innerHTML = `
      <button class="ghost-btn" id="ia-back">← Back to results</button>
      <div class="pl-header">
        <img class="pl-big-cover" src="https://archive.org/services/img/${esc(iaItemId)}" alt="" onerror="this.onerror=null;this.src='${posterURL(iaItemId, hueFor(iaItemId))}'">
        <div><div class="pl-type">Internet Archive</div>
          <div class="pl-title-big">${esc(title)}</div>
          <div class="pl-meta">${esc(creator)} • ${ids.length} tracks</div></div>
      </div>
      ${ids.length ? `<div class="pl-actions"><button class="big-play" id="ia-play">&#9654;</button></div>` + trackTable(ids)
        : `<div class="empty">No playable audio files in this item.</div>`}`;
    $('#ia-back').addEventListener('click', () => { iaItemId = null; renderFree(); });
    const pp = $('#ia-play');
    if (pp) pp.addEventListener('click', () => { setQueue(ids, 0); playCurrent(); });
    bindTrackRows(ids);
  } catch (e) {
    body.innerHTML = `<div class="sp-notice err">Couldn't load this item (${esc(e.message)}).</div>` + back;
    $('#ia-back').addEventListener('click', () => { iaItemId = null; renderFree(); });
  }
}

/* ---------------- Free music source 3: YouTube via official embeds (no ripping) ---------------- */
/* YouTube search & trending now run through the Tunebox backend (backend/worker.js),
   so the YouTube API key lives on the server and never appears in this file.
   BE_DEFAULT is the deployed backend; a custom URL can still be saved in the
   Free Music → YouTube tab (stored in localStorage). */
const BE_LS = 'tunebox.backend';
const BE_DEFAULT = 'https://tunebox-api.rahulgabagpt2.workers.dev';
function backendUrl() {
  try { return ((localStorage.getItem(BE_LS) || BE_DEFAULT).trim().replace(/\/+$/, '')); }
  catch (e) { return BE_DEFAULT; }
}
/* The raw custom URL the user saved ('' when using the built-in default).
   The default address is never shown in the UI — it lives here, not on screen. */
function backendCustom() {
  try { return (localStorage.getItem(BE_LS) || '').trim().replace(/\/+$/, ''); }
  catch (e) { return ''; }
}
function backendSave(u) {
  try { localStorage.setItem(BE_LS, String(u || '').trim().replace(/\/+$/, '')); } catch (e) { /* storage unavailable */ }
}
/* Self-healing: if a saved custom backend URL is dead, drop it and fall back
   to the built-in backend instead of silently breaking YouTube features. */
async function ensureBackend() {
  const custom = backendCustom();
  if (!custom) return;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    const res = await fetch(custom + '/api/yt/trending', { signal: ctl.signal });
    clearTimeout(t);
    if (res.ok) return; // custom backend is alive — keep it
  } catch (e) { /* unreachable */ }
  try { localStorage.removeItem(BE_LS); } catch (e) { /* storage unavailable */ }
  toast('Saved backend address was unreachable — switched back to the built-in one.');
}
function ytExtractId(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  const m = s.match(/(?:youtube\.com\/(?:watch\?[^#\s]*v=|shorts\/|embed\/|live\/|v\/)|youtu\.be\/)([\w-]{11})/);
  if (m) return m[1];
  if (/^[\w-]{11}$/.test(s)) return s;
  return null;
}

function renderFreeYouTube() {
  const customBe = backendCustom();
  $('#free-body').innerHTML = `
    <p class="sp-note">Plays through YouTube's official player — artists keep their revenue.</p>
    <div class="adsil-row">
      <div><div class="adsil-title">🔇 Ad Silencer</div><div class="adsil-sub">Auto-mutes YouTube ads while your music plays. One click to switch off.</div></div>
      <button id="adsil-toggle" class="ghost-btn ${adSilencerOn() ? 'on' : ''}">${adSilencerOn() ? 'On' : 'Off'}</button>
    </div>
    <div class="yt-status" id="yt-be-status"><span class="dot"></span>Checking backend…</div>
    <details class="adv">
      <summary>Advanced</summary>
      <div class="yt-keyrow">
        <input id="be-url" class="sp-input" placeholder="Custom backend URL (optional)" value="${esc(customBe)}" autocomplete="off">
        <button id="be-save" class="ghost-btn">Save</button>
        ${customBe ? '<button id="be-clear" class="ghost-btn">Reset</button>' : ''}
      </div>
      <p class="yt-hint">Only needed if you deploy your own backend. The API key always stays on the server, never in this page.</p>
    </details>
    <div class="uni-hint" style="margin:14px 0 4px">Tip: use the search bar at the top — it searches YouTube, Spotify, Audius and the Archive all at once.</div>
    <div class="yt-keyrow" style="margin-bottom:16px;max-width:520px">
      <input id="yt-link" class="sp-input" placeholder="Or paste a YouTube link / video ID…" autocomplete="off">
      <button id="yt-link-play" class="ghost-btn">Play</button>
    </div>
    <div id="yt-player"></div>
    <div id="yt-content"><div class="empty">Paste a YouTube link above to play it right away.</div></div>`;

  $('#be-save').addEventListener('click', () => { backendSave($('#be-url').value); renderFree(); });
  $('#adsil-toggle').addEventListener('click', () => { adSilencerSet(!adSilencerOn()); renderFree(); });
  const bc = $('#be-clear');
  if (bc) bc.addEventListener('click', () => { backendSave(''); renderFree(); });

  const playLink = () => {
    const id = ytExtractId($('#yt-link').value);
    if (!id) {
      $('#yt-content').innerHTML = '<div class="sp-notice err">Couldn\u2019t find a video ID in that link. Copy a youtube.com or youtu.be link and try again.</div>';
      return;
    }
    $('#yt-content').innerHTML = '';
    ytShowPlayer(id, 'YouTube video', 'youtube.com');
  };
  $('#yt-link-play').addEventListener('click', playLink);
  $('#yt-link').addEventListener('keydown', e => { if (e.key === 'Enter') playLink(); });

  if (ytPendingPlay) {
    const p = ytPendingPlay; ytPendingPlay = null;
    $('#yt-content').innerHTML = '';
    ytShowPlayer(p.id, p.title, p.channel);
  }

  // Real backend health check — the badge only claims "Connected" when the server answers.
  (async () => {
    const el = $('#yt-be-status');
    if (!el) return;
    const be = backendUrl();
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 6000);
      const res = await fetch(be + '/api/yt/trending', { signal: ctl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error('bad status');
      el.innerHTML = '<span class="dot"></span>Connected — search and trending are on';
    } catch (e) {
      el.innerHTML = '<span class="dot" style="background:#f85149;box-shadow:0 0 12px #f85149"></span>' +
        'Can\'t reach the backend — <button id="be-reset2" class="ghost-btn" style="margin-left:8px">Reset to built-in</button>';
      const r = $('#be-reset2');
      if (r) r.addEventListener('click', () => { backendSave(''); renderFree(); });
    }
  })();
}

function ytShowPlayer(id, title, channel, target) {
  stopYt(); // don't double-play if a Spotify track was streaming via the hidden YouTube audio player
  const host = document.getElementById(target || 'yt-player');
  if (!host) return;
  host.innerHTML = `
    <div class="yt-player-wrap">
      <iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0" title="${esc(title)}"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowfullscreen></iframe>
    </div>
    <div class="yt-now"><div class="t-title">${esc(title)}</div><div class="t-artist">${esc(channel)}</div></div>`;
  document.querySelectorAll('.yt-item').forEach(el => el.classList.toggle('playing', el.dataset.vid === id));
}

/* Trending music videos via the Tunebox backend (cached server-side 1h, ~1 API unit) */
let ytTrendCache = null, ytPendingPlay = null;
async function ytTrending() {
  if (ytTrendCache) return ytTrendCache;
  const be = backendUrl();
  if (!be) return [];
  const res = await fetch(be + '/api/yt/trending');
  if (!res.ok) throw new Error('Backend error ' + res.status);
  ytTrendCache = await res.json();
  return ytTrendCache;
}

/* "Recommended for you": YouTube's own search ranking, seeded from your taste.
 * Takes your top artists (from likes + play history) and favourite genres,
 * asks YouTube's algorithm for each, and merges the results. Cached 6h in
 * localStorage so it costs ~3 API calls per refresh, not per home visit. */
const YT_RECS_LS = 'tunebox.yt.recs';
async function ytRecommendations() {
  try {
    const c = JSON.parse(localStorage.getItem(YT_RECS_LS) || 'null');
    if (c && Date.now() - c.at < 6 * 3600_000 && c.items && c.items.length) return c.items;
  } catch (e) { /* no usable cache */ }
  const be = backendUrl();
  if (!be) return [];
  const artistScore = {};
  const addArtist = (t, w) => {
    const a = String(t.artist || '').split(/[,&]/)[0].trim();
    if (a && a.toLowerCase() !== 'unknown') artistScore[a] = (artistScore[a] || 0) + w;
  };
  liked.forEach(id => { const t = trackById(id); if (t) addArtist(t, 3); });
  listenLog.forEach(id => { const t = trackById(id); if (t) addArtist(t, 1); });
  const artists = Object.entries(artistScore).sort((a, b) => b[1] - a[1]).slice(0, 2).map(e => e[0]);
  const tags = tasteProfile().slice(0, 2).map(e => e[0]);
  const queries = [...artists.map(a => a + ' songs'), ...tags.map(g => g + ' music')].slice(0, 3);
  if (!queries.length) return [];
  const seen = new Set(), out = [];
  for (const q of queries) {
    try {
      const res = await fetch(be + '/api/yt/search?' + new URLSearchParams({ q }));
      if (!res.ok) continue;
      const items = await res.json();
      for (const v of items) {
        if (!v || !v.id || seen.has(v.id)) continue;
        seen.add(v.id);
        out.push({ id: v.id, title: v.title, channel: v.channel, thumb: v.thumb, seed: q });
        if (out.length >= 12) break;
      }
    } catch (e) { /* one failed seed must not kill the rest */ }
    if (out.length >= 12) break;
  }
  try { localStorage.setItem(YT_RECS_LS, JSON.stringify({ at: Date.now(), items: out })); } catch (e) { /* storage unavailable */ }
  return out;
}

