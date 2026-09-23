/* Tunebox - offline music player. All demo tracks are original compositions. */
'use strict';

/* ---------------- Data ---------------- */
const BUILTIN = [
  { id: 't1', title: 'Midnight Drive',   artist: 'Neon Coast',    album: 'Afterglow',   src: 'assets/audio/track1.wav', duration: 19.2, hue: 265, tags: ['electronic', 'chill'] },
  { id: 't2', title: 'Solar Bloom',      artist: 'Aurora Fields', album: 'Daybreak',    src: 'assets/audio/track2.wav', duration: 16.0, hue: 45,  tags: ['pop', 'chill'] },
  { id: 't3', title: 'Static Dreams',    artist: 'Velvet Circuit',album: 'Neon Static', src: 'assets/audio/track3.wav', duration: 15.0, hue: 200, tags: ['electronic', 'workout'] },
  { id: 't4', title: 'Tidal',             artist: 'Blue Meridian', album: 'Drift',       src: 'assets/audio/track4.wav', duration: 20.9, hue: 190, tags: ['ambient', 'chill'] },
  { id: 't5', title: 'Paper Satellites', artist: 'The Orbiters',  album: 'Low Orbit',   src: 'assets/audio/track5.wav', duration: 17.5, hue: 280, tags: ['rock', 'indie'] },
  { id: 't6', title: 'Amber Skies',       artist: 'Field Notes',   album: 'Harvest',     src: 'assets/audio/track6.wav', duration: 18.3, hue: 25,  tags: ['indie', 'chill'] },
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
const LS_PL = 'tunebox.playlists', LS_LIKED = 'tunebox.liked';
function saveLS() {
  localStorage.setItem(LS_PL, JSON.stringify(playlists.filter(p => !p.builtin)));
  localStorage.setItem(LS_LIKED, JSON.stringify([...liked]));
}
function loadLS() {
  try {
    const pl = JSON.parse(localStorage.getItem(LS_PL) || '[]');
    playlists.push(...pl);
    liked = new Set(JSON.parse(localStorage.getItem(LS_LIKED) || '[]'));
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
const trackById = id => library.find(t => t.id === id) || spotifyTrackCache[id] || audiusTrackCache[id] || archiveTrackCache[id];
const coverStyle = t => `background: linear-gradient(135deg, hsl(${t.hue},70%,45%), hsl(${(t.hue + 50) % 360},75%,28%))`;
const coverHTML = (t, cls) => t.image
  ? `<div class="${cls}" style="background-image:url('${t.image}');background-size:cover;background-position:center"></div>`
  : `<div class="${cls}" style="${coverStyle(t)}"></div>`;
const totalDur = ids => ids.reduce((a, id) => a + (trackById(id)?.duration || 0), 0);

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
  if (isSpotifyTrack(t)) {
    audio.pause(); // stop any local playback first
    try {
      await ensureSpotifyPlayer();
      await waitFor(() => spDeviceId, 12000);
      await spPlayUri(t.spotifyUri);
    } catch (e) {
      spNotice('Could not start Spotify playback: ' + (e.message || e));
    }
  } else {
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
  if (currentIsSpotify()) {
    if (spPlayer) (spPlaying ? spPlayer.pause() : spPlayer.resume()).catch(() => {});
  } else {
    audio.paused ? audio.play().catch(() => {}) : audio.pause();
  }
  syncPlayerUI();
}
function step(dir) {
  if (!queue.length) return;
  const pos = currentIsSpotify() ? spPosition / 1000 : audio.currentTime;
  if (dir < 0 && pos > 3) {
    if (currentIsSpotify() && spPlayer) spPlayer.seek(0).catch(() => {});
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
function isPlaying() { const t = currentTrack(); return t && t.source === 'spotify' ? spPlaying : !audio.paused; }
function syncPlayBtn() { $('#play').innerHTML = isPlaying() ? '&#10073;&#10073;' : '&#9654;'; }
function syncPlayerUI() {
  const t = currentTrack();
  syncPlayBtn();
  if (!t) return;
  const covCss = t.image ? `background-image:url("${t.image}");background-size:cover;background-position:center` : coverStyle(t);
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
  const name = prompt('Name your playlist:');
  if (!name || !name.trim()) return;
  playlists.push({ id: 'p' + Date.now(), name: name.trim(), trackIds: [], desc: 'Your playlist.', hue: Math.floor(Math.random() * 360) });
  saveLS(); renderSidebar(); go('playlist', playlists[playlists.length - 1].id);
}
function addToPlaylist(trackId) {
  const opts = playlists.map((p, i) => `${i + 1}. ${p.name}`).join('\n');
  const sel = prompt(`Add to playlist (number):\n${opts}`);
  const p = playlists[parseInt(sel, 10) - 1];
  if (p && !p.trackIds.includes(trackId)) { p.trackIds.push(trackId); saveLS(); if (currentView.name !== 'spotify' && currentView.name !== 'free') rerender(); }
}

/* ---------------- Rendering: sidebar ---------------- */
function renderSidebar() {
  const el = $('#playlist-list');
  const likedPl = { id: '__liked', name: 'Liked Songs', count: liked.size, hue: 265, heart: true };
  el.innerHTML = [likedPl, ...playlists].map(p => `
    <button class="pl-item" data-pl="${p.id}">
      <div class="pl-cover" style="background:linear-gradient(135deg,hsl(${p.hue},70%,45%),hsl(${(p.hue+50)%360},75%,28%))">${p.heart ? '&#9829;' : '&#9835;'}</div>
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
  return `<tr class="track-row" data-id="${t.id}">
    <td><button class="row-play">${i + 1}</button></td>
    <td><div class="t-cell">${coverHTML(t, 't-cover')}
      <div><div class="t-title">${esc(t.title)}</div><div class="t-artist">${esc(t.artist)}</div></div></div></td>
    <td class="t-album">${esc(t.album || '—')}</td>
    <td class="t-dur">${fmt(t.duration)}</td>
    <td><button class="like-btn ${isLiked ? 'liked' : ''}" data-like="${t.id}">${isLiked ? '&#9829;' : '&#9825;'}</button></td>
  </tr>`;
}
function bindTrackRows(ctxIds) {
  document.querySelectorAll('.track-row').forEach(r => {
    const id = r.dataset.id;
    r.addEventListener('click', e => {
      if (e.target.closest('[data-like]')) return;
      playTrackById(id, ctxIds);
    });
    r.addEventListener('dblclick', () => addToPlaylist(id));
  });
  document.querySelectorAll('[data-like]').forEach(b =>
    b.addEventListener('click', e => { e.stopPropagation(); toggleLike(b.dataset.like); }));
}

function playlistHeader(p, ids) {
  return `<div class="pl-header">
    <div class="pl-big-cover" style="background:linear-gradient(135deg,hsl(${p.hue},70%,45%),hsl(${(p.hue+50)%360},75%,28%))">${p.heart ? '&#9829;' : '&#9835;'}</div>
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

function renderHome() {
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const quick = [...playlists].slice(0, 6);
  const cards = playlists.map(p => `
    <button class="card" data-pl="${p.id}">
      <div class="c-cover" style="background:linear-gradient(135deg,hsl(${p.hue},70%,45%),hsl(${(p.hue+50)%360},75%,28%))"></div>
      <div class="c-title">${esc(p.name)}</div><div class="c-sub">${esc(p.desc || p.trackIds.length + ' songs')}</div>
      <span class="c-play" data-play-pl="${p.id}">&#9654;</span>
    </button>`).join('');
  $('#view').innerHTML = `
    <div class="greeting">${greet}</div>
    <div class="quick-grid">${quick.map(p => `
      <button class="quick-card" data-pl="${p.id}">
        <div class="qc-cover" style="background:linear-gradient(135deg,hsl(${p.hue},70%,45%),hsl(${(p.hue+50)%360},75%,28%))"></div>
        <span>${esc(p.name)}</span>
      </button>`).join('')}</div>
    <div class="section-title">Made for you</div>
    <div class="card-grid">${cards}</div>
    <div class="section-title">All tracks</div>
    ${trackTable(library.map(t => t.id))}`;
  bindCards(); bindTrackRows(library.map(t => t.id));
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

function renderSearch(q) {
  const query = (q || '').trim().toLowerCase();
  let html = '';
  if (!query) {
    html = `<div class="greeting">Browse all</div><div class="cat-grid">${CATEGORIES.map(c => `
      <button class="cat-card" data-q="${c.q}" style="background:linear-gradient(135deg,hsl(${c.hue},65%,42%),hsl(${(c.hue+40)%360},70%,26%))">${c.name}</button>`).join('')}</div>`;
  } else {
    const hits = library.filter(t => (t.title + ' ' + t.artist + ' ' + (t.album || '')).toLowerCase().includes(query)).map(t => t.id);
    const plHits = playlists.filter(p => p.name.toLowerCase().includes(query));
    html = `<div class="section-title">Results for "${esc(q)}"</div>`;
    if (plHits.length) html += `<div class="card-grid">${plHits.map(p => `
      <button class="card" data-pl="${p.id}">
        <div class="c-cover" style="background:linear-gradient(135deg,hsl(${p.hue},70%,45%),hsl(${(p.hue+50)%360},75%,28%))"></div>
        <div class="c-title">${esc(p.name)}</div><div class="c-sub">${p.trackIds.length} songs</div>
      </button>`).join('')}</div>`;
    html += trackTable(hits);
    if (!hits.length && !plHits.length) html = `<div class="empty">No results for "${esc(q)}". Try something else.</div>`;
  }
  $('#view').innerHTML = html;
  document.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => {
    $('#search-input').value = b.dataset.q;
    go('search', b.dataset.q);
  }));
  bindCards();
  const ids = library.filter(t => (t.title + ' ' + t.artist + ' ' + (t.album || '')).toLowerCase().includes(query)).map(t => t.id);
  bindTrackRows(ids);
}

function renderPlaylist(id) {
  const p = playlists.find(x => x.id === id);
  if (!p) { go('home'); return; }
  $('#view').innerHTML = playlistHeader(p, p.trackIds) + trackTable(p.trackIds);
  $('#pl-play').addEventListener('click', () => { if (p.trackIds.length) { setQueue(p.trackIds, 0); playCurrent(); } });
  const del = $('#pl-delete');
  if (del) del.addEventListener('click', () => {
    if (confirm(`Delete "${p.name}"?`)) { playlists = playlists.filter(x => x.id !== id); saveLS(); renderSidebar(); go('home'); }
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
  $('#search-input').hidden = name !== 'search';
  if (name === 'search' && arg) $('#search-input').value = arg;
  rerender();
}
function navHist(d) {
  const n = hIndex + d;
  if (n < 0 || n >= history.length) return;
  hIndex = n; currentView = history[n];
  document.querySelectorAll('.nav-item').forEach(x => x.classList.toggle('active', x.dataset.view === currentView.name));
  $('#search-input').hidden = currentView.name !== 'search';
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
}

/* ---------------- Wire up ---------------- */
async function init() {
  loadLS(); loadAuCache(); loadIaCache(); seedPlaylists(); renderSidebar(); renderQueue();
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
    if (currentIsSpotify()) { if (spPlayer && spDuration) spPlayer.seek(Math.round(seek.value / 1000 * spDuration)).catch(() => {}); }
    else if (audio.duration) audio.currentTime = seek.value / 1000 * audio.duration;
  });
  const vol = $('#volume');
  vol.addEventListener('input', () => {
    const v = vol.value / 100;
    if (currentIsSpotify() && spPlayer) { spPlayer.setVolume(v).catch(() => {}); spMutedVol = null; $('#mute').innerHTML = '&#128266;'; }
    else { audio.volume = v; audio.muted = false; }
  });
  $('#mute').addEventListener('click', () => {
    if (currentIsSpotify() && spPlayer) {
      if (spMutedVol === null) spPlayer.getVolume().then(v => { spMutedVol = v; spPlayer.setVolume(0); $('#mute').innerHTML = '&#128263;'; }).catch(() => {});
      else { spPlayer.setVolume(spMutedVol).catch(() => {}); spMutedVol = null; $('#mute').innerHTML = '&#128266;'; }
    } else { audio.muted = !audio.muted; $('#mute').innerHTML = audio.muted ? '&#128263;' : '&#128266;'; }
  });
  let searchTimer;
  $('#search-input').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => go('search', e.target.value), 250);
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
  go(authed ? 'spotify' : 'home');
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
   Spotify rejects the "localhost" hostname, so local dev uses the explicit loopback IP. */
const redirectUri = () => {
  const h = window.location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') return 'http://127.0.0.1:8000';
  return window.location.origin + window.location.pathname;
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
    spNotice('This Spotify account is not Premium — Spotify requires Premium for in-app playback.');
  });
  spPlayer.addListener('playback_error', ({ message }) => spNotice('Spotify playback error: ' + message));
  const ok = await spPlayer.connect();
  if (!ok) throw new Error('could not connect the Spotify player');
  if (!spPollTimer) spPollTimer = setInterval(async () => {
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
function spNotice(msg) {
  let el = $('#sp-toast');
  if (!el) { el = document.createElement('div'); el.id = 'sp-toast'; document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('show');
  clearTimeout(spNotice._t); spNotice._t = setTimeout(() => el.classList.remove('show'), 4500);
}

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
    <p>Play the full Spotify catalog inside Tunebox. You need a <b>Spotify Premium</b> account and a free Client ID.</p>
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
    <p class="sp-note">Requires <b>Spotify Premium</b> — Spotify's player only works on Premium accounts.</p>
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
    ${spPremium ? '' : `<div class="sp-notice err">This Spotify account is not Premium. Spotify only allows in-app playback for Premium accounts — your local library keeps working as normal.</div>`}
    <div class="sp-tabs">
      <button class="sp-tab ${st.tab === 'playlists' && !st.playlistId ? 'on' : ''}" data-sptab="playlists">Playlists</button>
      <button class="sp-tab ${st.tab === 'liked' ? 'on' : ''}" data-sptab="liked">Liked Songs</button>
      <button class="sp-tab ${st.tab === 'all' ? 'on' : ''}" data-sptab="all">All Songs</button>
      <button class="sp-tab ${st.tab === 'search' ? 'on' : ''}" data-sptab="search">Search</button>
    </div>
    <div id="sp-content"><div class="empty">Loading…</div></div>`;
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
      ${p.images?.[0]?.url ? `<img class="c-cover" src="${p.images[0].url}" alt="">` : `<div class="c-cover" style="background:linear-gradient(135deg,hsl(${hue},70%,45%),hsl(${(hue + 50) % 360},75%,28%))"></div>`}
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
      ${img ? `<img class="pl-big-cover" src="${img}" alt="">` : `<div class="pl-big-cover" style="background:linear-gradient(135deg,hsl(160,70%,45%),hsl(210,75%,28%))">&#9835;</div>`}
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
          ${a.images?.[0]?.url ? `<img class="c-cover" src="${a.images[0].url}" alt="">` : ''}
          <div class="c-title">${esc(a.name)}</div><div class="c-sub">Album • ${esc((a.artists || []).map(x => x.name).join(', '))}</div>
        </button>`).join('');
      html += pls.map(p => `
        <button class="card" data-sppl="${p.id}">
          ${p.images?.[0]?.url ? `<img class="c-cover" src="${p.images[0].url}" alt="">` : ''}
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
      ${img ? `<img class="pl-big-cover" src="${img}" alt="">` : `<div class="pl-big-cover" style="background:linear-gradient(135deg,hsl(160,70%,45%),hsl(210,75%,28%))">&#9835;</div>`}
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
    <input id="au-search" class="sp-input" placeholder="Search free music…" value="${esc(auQuery)}" autocomplete="off" style="margin-bottom:16px;max-width:420px">
    <div id="au-content"><div class="empty">Loading…</div></div>`;
  document.querySelectorAll('.au-genre').forEach(b => b.addEventListener('click', () => {
    auGenre = b.dataset.g; auQuery = ''; renderFree();
  }));
  const inp = $('#au-search');
  let timer;
  inp.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { auQuery = inp.value; loadAuTracks(); }, 450); });
  await loadAuTracks();
}

async function loadAuTracks() {
  const box = $('#au-content');
  if (!box) return;
  box.innerHTML = `<div class="empty">Loading…</div>`;
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
    <input id="ia-search" class="sp-input" placeholder="Search the Archive: artists, concerts, old radio…" value="${esc(iaQuery)}" autocomplete="off" style="margin-bottom:16px;max-width:420px">
    <div id="ia-content"><div class="empty">Loading…</div></div>`;
  const inp = $('#ia-search');
  let timer;
  inp.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { iaQuery = inp.value; loadIaResults(); }, 500); });
  await loadIaResults();
}

async function loadIaResults() {
  const box = $('#ia-content');
  if (!box) return;
  box.innerHTML = `<div class="empty">Loading…</div>`;
  try {
    const docs = await iaSearch(iaQuery);
    if (!docs.length) { box.innerHTML = `<div class="empty">No results — try another search.</div>`; return; }
    box.innerHTML = `<div class="section-title">${iaQuery.trim() ? `Results for "${esc(iaQuery.trim())}"` : 'Popular live recordings'}</div><div class="card-grid">` +
      docs.map(d => `
        <button class="card" data-iaid="${esc(d.identifier)}">
          <img class="c-cover" src="https://archive.org/services/img/${esc(d.identifier)}" alt="" loading="lazy" onerror="this.style.display='none'">
          <div class="c-title">${esc(d.title || d.identifier)}</div>
          <div class="c-sub">${esc(d.creator || '')}${d.year ? ' • ' + esc(d.year) : ''}</div>
        </button>`).join('') + `</div>`;
    box.querySelectorAll('[data-iaid]').forEach(b => b.addEventListener('click', () => { iaItemId = b.dataset.iaid; renderFree(); }));
  } catch (e) {
    box.innerHTML = `<div class="sp-notice err">Couldn't reach archive.org (${esc(e.message)}). Check your connection and try again.</div>`;
  }
}

async function renderIaDetail() {
  const body = $('#free-body');
  const back = `<div style="margin-top:12px"><button class="ghost-btn" id="ia-back">← Back to results</button></div>`;
  body.innerHTML = `<div class="empty">Loading tracks…</div>`;
  try {
    const { title, creator, ids } = await iaLoadItem(iaItemId);
    body.innerHTML = `
      <button class="ghost-btn" id="ia-back">← Back to results</button>
      <div class="pl-header">
        <img class="pl-big-cover" src="https://archive.org/services/img/${esc(iaItemId)}" alt="" onerror="this.style.display='none'">
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
const YT_KEY_LS = 'tunebox.ytkey';
// Pre-installed free YouTube Data API v3 key so search works out of the box.
// Restricted to YouTube Data API v3 only — replace it with your own key anytime.
const YT_DEFAULT_KEY = 'AIzaSyCOwqWKzX_XmN_uLzLs7ZDA3-wMLyoTRaM';
let ytQuery = '';

function ytKey() {
  try {
    const v = localStorage.getItem(YT_KEY_LS);
    if (v === null) return YT_DEFAULT_KEY; // never set: use the pre-installed key
    return v.trim(); // explicitly saved (empty string = cleared by user)
  } catch (e) { return YT_DEFAULT_KEY; }
}
function ytSaveKey(k) {
  try { localStorage.setItem(YT_KEY_LS, k.trim()); } catch (e) { /* storage unavailable */ }
}
function ytExtractId(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  const m = s.match(/(?:youtube\.com\/(?:watch\?[^#\s]*v=|shorts\/|embed\/|live\/|v\/)|youtu\.be\/)([\w-]{11})/);
  if (m) return m[1];
  if (/^[\w-]{11}$/.test(s)) return s;
  return null;
}
function ytIsoSecs(iso) {
  const m = String(iso || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || '0', 10) * 3600) + (parseInt(m[2] || '0', 10) * 60) + parseInt(m[3] || '0', 10);
}

function renderFreeYouTube() {
  const key = ytKey();
  $('#free-body').innerHTML = `
    <p class="sp-note">Plays through YouTube's official player — artists keep their revenue. Search works out of the box; pasting a link works with no key at all.</p>
    <div class="yt-keyrow">
      <input id="yt-key" class="sp-input" type="password" placeholder="Paste your YouTube API key here (for search)" value="${esc(key)}" autocomplete="off">
      <button id="yt-key-save" class="ghost-btn">Save</button>
      ${key ? '<button id="yt-key-clear" class="ghost-btn">Clear</button>' : ''}
    </div>
    <p class="yt-hint">A free YouTube API key comes pre-installed, so search works right away. You can replace it with your own key anytime — your own key stays in this browser only.</p>
    <input id="yt-search" class="sp-input" placeholder="Search YouTube music…" value="${esc(ytQuery)}" autocomplete="off" style="margin:14px 0;max-width:420px"${key ? '' : ' disabled'}>
    <div class="yt-keyrow" style="margin-bottom:16px;max-width:520px">
      <input id="yt-link" class="sp-input" placeholder="Or paste a YouTube link / video ID…" autocomplete="off">
      <button id="yt-link-play" class="ghost-btn">Play</button>
    </div>
    <div id="yt-player"></div>
    <div id="yt-content">${key ? '<div class="empty">Search for music videos above.</div>' : '<div class="empty">Add your API key to search, or paste a YouTube link to play it right away.</div>'}</div>`;

  $('#yt-key-save').addEventListener('click', () => { ytSaveKey($('#yt-key').value); renderFree(); });
  const kc = $('#yt-key-clear');
  if (kc) kc.addEventListener('click', () => { ytSaveKey(''); renderFree(); });

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

  if (ytKey()) {
    const inp = $('#yt-search');
    let timer;
    inp.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { ytQuery = inp.value; ytDoSearch(); }, 600); });
  }
}

function ytShowPlayer(id, title, channel) {
  $('#yt-player').innerHTML = `
    <div class="yt-player-wrap">
      <iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0" title="${esc(title)}"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowfullscreen></iframe>
    </div>
    <div class="yt-now"><div class="t-title">${esc(title)}</div><div class="t-artist">${esc(channel)}</div></div>`;
  document.querySelectorAll('.yt-item').forEach(el => el.classList.toggle('playing', el.dataset.vid === id));
}

async function ytDoSearch() {
  const box = $('#yt-content');
  if (!box) return;
  const q = ytQuery.trim();
  if (!q) { box.innerHTML = '<div class="empty">Search for music videos above.</div>'; return; }
  const key = ytKey();
  if (!key) { box.innerHTML = '<div class="sp-notice err">Add your YouTube API key above to search, or paste a link to play it directly.</div>'; return; }
  box.innerHTML = '<div class="empty">Searching YouTube…</div>';
  try {
    const sp = new URLSearchParams({ part: 'snippet', type: 'video', videoCategoryId: '10', maxResults: '25', q, key });
    const res = await fetch('https://www.googleapis.com/youtube/v3/search?' + sp.toString());
    if (res.status === 400 || res.status === 403) throw new Error('YouTube rejected the request — check that your API key is valid and YouTube Data API v3 is enabled.');
    if (!res.ok) throw new Error('YouTube error (' + res.status + ')');
    const json = await res.json();
    const items = (json.items || []).filter(i => i.id && i.id.videoId);
    if (!items.length) { box.innerHTML = '<div class="empty">No videos found — try another search.</div>'; return; }
    const ids = items.map(i => i.id.videoId).join(',');
    const durs = {};
    try {
      const vres = await fetch('https://www.googleapis.com/youtube/v3/videos?' + new URLSearchParams({ part: 'contentDetails', id: ids, key }).toString());
      if (vres.ok) {
        const vj = await vres.json();
        (vj.items || []).forEach(v => { durs[v.id] = ytIsoSecs(v.contentDetails && v.contentDetails.duration); });
      }
    } catch (e) { /* durations are optional */ }
    box.innerHTML = '<div class="section-title">Results for &ldquo;' + esc(q) + '&rdquo;</div><div class="yt-list">' +
      items.map(i => {
        const vid = i.id.videoId;
        const sn = i.snippet || {};
        const th = sn.thumbnails && (sn.thumbnails.medium || sn.thumbnails.default);
        return '<div class="yt-item" data-vid="' + vid + '" data-title="' + esc(sn.title || 'YouTube video') + '" data-channel="' + esc(sn.channelTitle || '') + '">' +
          (th ? '<img class="yt-thumb" src="' + esc(th.url) + '" alt="" loading="lazy">' : '<div class="yt-thumb"></div>') +
          '<div class="yt-meta"><div class="t-title">' + esc(sn.title || 'YouTube video') + '</div><div class="t-artist">' + esc(sn.channelTitle || '') + '</div></div>' +
          '<div class="t-dur">' + (durs[vid] ? fmt(durs[vid]) : '') + '</div></div>';
      }).join('') + '</div>';
    box.querySelectorAll('.yt-item').forEach(el => el.addEventListener('click', () => {
      ytShowPlayer(el.dataset.vid, el.dataset.title, el.dataset.channel);
    }));
  } catch (e) {
    box.innerHTML = '<div class="sp-notice err">Couldn\u2019t search YouTube (' + esc(e.message) + '). Check your connection and key, then try again.</div>';
  }
}
