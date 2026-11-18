import { toCamelot, formatKey } from './camelot.js';

const api = window.api;
const $ = (id) => document.getElementById(id);

const el = (tag, props = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) n.append(c);
  return n;
};

const fmtFans = (n) =>
  n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M fans' : n >= 1e3 ? Math.round(n / 1e3) + 'K fans' : `${n || 0} fans`;
const fmtDur = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const TYPE_LABEL = { album: 'Album', ep: 'EP', single: 'Single', compile: 'Compilation' };

/* ---------------- Navigation (screens stay in the DOM, so state is kept) ---------------- */

const stack = [{ screen: 'search' }];
const screens = { search: $('screen-search'), artist: $('screen-artist'), album: $('screen-album') };
const scrollPos = {};

function show(entry) {
  const main = document.querySelector('main');
  for (const [name, node] of Object.entries(screens)) node.hidden = name !== entry.screen;
  $('backBtn').hidden = stack.length <= 1;
  renderCrumbs();
  main.scrollTop = scrollPos[entry.screen + ':' + (entry.id || '')] || 0;
}

function push(entry) {
  const cur = stack[stack.length - 1];
  scrollPos[cur.screen + ':' + (cur.id || '')] = document.querySelector('main').scrollTop;
  stack.push(entry);
  show(entry);
}

function back(toIndex = stack.length - 2) {
  if (toIndex < 0 || stack.length <= 1) return;
  const leaving = stack[stack.length - 1];
  scrollPos[leaving.screen + ':' + (leaving.id || '')] = document.querySelector('main').scrollTop;
  stack.length = toIndex + 1;
  if (leaving.screen === 'album' || stack[stack.length - 1].screen !== 'album') statsQueue.clear();
  show(stack[stack.length - 1]);
  if (stack[stack.length - 1].screen === 'search') $('searchInput').focus();
}

function renderCrumbs() {
  const nav = $('crumbs');
  nav.replaceChildren();
  stack.forEach((e, i) => {
    const label = e.screen === 'search' ? 'Search' : e.label;
    if (i > 0) nav.append(el('span', { class: 'sep' }, '/'));
    if (i === stack.length - 1) nav.append(el('span', { class: 'current', title: label }, label));
    else nav.append(el('button', { title: label, onclick: () => back(i) }, label));
  });
}

$('backBtn').addEventListener('click', () => back());
window.addEventListener('keydown', (e) => {
  const typing = e.target.matches('input, textarea');
  if ((e.altKey && e.key === 'ArrowLeft') || (e.key === 'Backspace' && !typing) || (e.key === 'Escape' && !typing && !$('settingsDialog').open)) {
    e.preventDefault();
    back();
  }
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 3) back(); // mouse "back" button
});

/* ---------------- Search ---------------- */

let searchSeq = 0;
let searchTimer = null;

$('searchInput').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (!q) {
    searchSeq++;
    $('artistResults').replaceChildren();
    setStatus('searchStatus', '');
    return;
  }
  searchTimer = setTimeout(() => runSearch(q), 300);
});
$('searchInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    if (q) runSearch(q);
  } else if (e.key === 'ArrowDown') {
    const first = $('artistResults').querySelector('button');
    if (first) {
      e.preventDefault();
      first.focus();
    }
  }
});
$('artistResults').addEventListener('keydown', (e) => {
  const items = [...$('artistResults').querySelectorAll('button')];
  const i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown' && i < items.length - 1) items[i + 1].focus();
  else if (e.key === 'ArrowUp') (i > 0 ? items[i - 1] : $('searchInput')).focus();
  else return;
  e.preventDefault();
});

async function runSearch(q) {
  const seq = ++searchSeq;
  setStatus('searchStatus', 'Searching…');
  try {
    const artists = await api.searchArtists(q);
    if (seq !== searchSeq) return; // a newer search superseded this one
    setStatus('searchStatus', artists.length ? '' : `No artists found for “${q}”.`);
    $('artistResults').replaceChildren(
      ...artists.map((a) =>
        el(
          'li',
          {},
          el(
            'button',
            { onclick: () => openArtist(a) },
            el('img', { class: 'avatar', src: a.picture, alt: '', loading: 'lazy' }),
            el('div', {}, el('div', { class: 'name' }, a.name), el('div', { class: 'muted small' }, fmtFans(a.fans))),
          ),
        ),
      ),
    );
  } catch (err) {
    if (seq === searchSeq) setStatus('searchStatus', `Search failed: ${err.message}`, true);
  }
}

/* ---------------- Artist ---------------- */

const FILTERS = [
  { id: 'album', label: 'Albums', types: ['album', 'compile'] },
  { id: 'ep', label: 'EPs', types: ['ep'] },
  { id: 'single', label: 'Singles', types: ['single'] },
  { id: 'all', label: 'All', types: null },
];
let artistState = { id: null, albums: [], filter: 'album' };
let artistSeq = 0;

async function openArtist(a) {
  push({ screen: 'artist', id: a.id, label: a.name });
  if (artistState.id === a.id && artistState.albums.length) return; // keep previous state

  const seq = ++artistSeq;
  artistState = { id: a.id, albums: [], filter: 'album' };
  $('artistName').textContent = a.name;
  $('artistPic').src = a.picture || '';
  $('artistMeta').textContent = fmtFans(a.fans);
  $('albumGrid').replaceChildren();
  $('typeFilter').replaceChildren();
  setStatus('artistStatus', 'Loading discography…');
  try {
    const { albums } = await api.artistAlbums(a.id);
    if (seq !== artistSeq) return;
    artistState.albums = albums;
    // Default to Albums unless the artist has none.
    if (!albums.some((x) => x.type === 'album' || x.type === 'compile')) artistState.filter = 'all';
    setStatus('artistStatus', albums.length ? '' : 'No releases found.');
    renderAlbums();
  } catch (err) {
    if (seq === artistSeq) setStatus('artistStatus', `Couldn't load releases: ${err.message}`, true);
  }
}

function renderAlbums() {
  const { albums, filter } = artistState;
  $('typeFilter').replaceChildren(
    ...FILTERS.map((f) => {
      const count = f.types ? albums.filter((a) => f.types.includes(a.type)).length : albums.length;
      return el(
        'button',
        {
          class: 'chip',
          role: 'tab',
          'aria-selected': String(f.id === filter),
          onclick: () => {
            artistState.filter = f.id;
            renderAlbums();
          },
        },
        f.label,
        el('span', { class: 'count' }, String(count)),
      );
    }),
  );
  const f = FILTERS.find((x) => x.id === filter);
  const shown = f.types ? albums.filter((a) => f.types.includes(a.type)) : albums;
  $('albumGrid').replaceChildren(
    ...shown.map((al) =>
      el(
        'button',
        { class: 'album-card', onclick: () => openAlbum(al), title: al.title },
        el('img', { src: al.cover, alt: '', loading: 'lazy' }),
        el('div', { class: 't' }, al.title),
        el('div', { class: 'y' }, [al.year, f.id === 'all' || al.type === 'compile' ? TYPE_LABEL[al.type] : ''].filter(Boolean).join(' · ')),
      ),
    ),
  );
  if (albums.length && !shown.length) setStatus('artistStatus', `No ${f.label.toLowerCase()} for this artist.`);
  else if (albums.length) setStatus('artistStatus', '');
}

/* ---------------- Album ---------------- */

let albumState = { id: null, tracks: [], rows: new Map(), stats: new Map() };
let albumSeq = 0;

async function openAlbum(al) {
  push({ screen: 'album', id: al.id, label: al.title });
  if (albumState.id === al.id && albumState.tracks.length) {
    // Same album as before: re-queue anything still missing (queue is cleared on leave).
    queueMissing();
    return;
  }
  stopPlayback();
  const seq = ++albumSeq;
  albumState = { id: al.id, tracks: [], rows: new Map(), stats: new Map() };
  $('albumCover').src = al.cover || '';
  $('albumTitle').textContent = al.title;
  $('albumType').textContent = TYPE_LABEL[al.type] || '';
  $('albumMeta').textContent = al.year || '';
  $('albumProgress').textContent = '';
  $('trackRows').replaceChildren();
  setStatus('albumStatus', 'Loading tracks…');

  try {
    const album = await api.album(al.id);
    if (seq !== albumSeq) return;
    albumState.tracks = album.tracks;
    albumState.artist = album.artist;
    $('albumMeta').textContent = [album.artist, album.year, `${album.tracks.length} tracks`].filter(Boolean).join(' · ');
    setStatus('albumStatus', '');

    // Rows render immediately with placeholders.
    const multiArtist = album.tracks.some((t) => t.artist && t.artist !== album.artist);
    $('trackRows').replaceChildren(...album.tracks.map((t) => buildRow(t, multiArtist)));

    // Cached stats fill in synchronously, the rest are queued (max 3 concurrent).
    const cached = await api.cachedStats(album.tracks.map((t) => t.id));
    if (seq !== albumSeq) return;
    for (const [id, s] of Object.entries(cached)) applyStats(Number(id), s);
    queueMissing();
  } catch (err) {
    if (seq === albumSeq) setStatus('albumStatus', `Couldn't load album: ${err.message}`, true);
  }
}

function queueMissing() {
  const seq = albumSeq;
  for (const t of albumState.tracks) {
    if (albumState.stats.has(t.id)) continue;
    setLoading(t.id);
    statsQueue.add(async () => {
      if (seq !== albumSeq) return;
      try {
        const s = await api.getStats({
          deezerTrackId: t.id,
          title: t.title,
          artist: t.artist || albumState.artist,
          previewUrl: t.preview,
        });
        if (seq !== albumSeq) return;
        if (s && s.authError) showAuthError(s.authError);
        applyStats(t.id, s);
      } catch (err) {
        if (seq === albumSeq) applyStats(t.id, { bpm: null, key: null, source: 'error', error: err.message });
      }
    });
  }
  updateProgress();
}

function buildRow(t, multiArtist) {
  const playBtn = el(
    'button',
    { class: 'play', title: t.preview ? 'Play 30 s preview' : 'No preview', disabled: !t.preview, onclick: () => togglePlay(t, playBtn) },
    playIcon(),
  );
  const cells = {
    bpm: el('td', { class: 'c-bpm' }),
    key: el('td', { class: 'c-key' }),
    cam: el('td', { class: 'c-cam' }),
    src: el('td', { class: 'c-src' }),
  };
  const tr = el(
    'tr',
    {},
    el('td', { class: 'c-play' }, playBtn),
    el('td', { class: 'c-num' }, String(t.position)),
    el('td', { class: 'c-title' }, el('div', { class: 'tt' }, t.title), multiArtist ? el('div', { class: 'ta' }, t.artist) : null),
    el('td', { class: 'c-dur' }, fmtDur(t.duration)),
    cells.bpm,
    cells.key,
    cells.cam,
    cells.src,
  );
  albumState.rows.set(t.id, { tr, cells, playBtn });
  return tr;
}

const dash = () => el('span', { class: 'dash' }, '—');
const spinner = () => el('span', { class: 'spinner', title: 'Looking up…' });

function setLoading(id) {
  const row = albumState.rows.get(id);
  if (!row) return;
  row.cells.bpm.replaceChildren(spinner());
  row.cells.key.replaceChildren();
  row.cells.cam.replaceChildren();
  row.cells.src.replaceChildren();
}

const SRC_LABEL = { getsongbpm: 'GetSongBPM', deezer: 'Deezer', local: 'Local est.', none: 'Not found', error: 'Error' };

function applyStats(id, s) {
  albumState.stats.set(id, s);
  const row = albumState.rows.get(id);
  if (!row) return;
  const { cells } = row;
  const bpmEst = s && s.bpmSource === 'local';
  const keyEst = s && s.keySource === 'local';

  const estTag = () => el('span', { class: 'est', title: 'Estimated from the 30 s preview' }, 'est.');
  cells.bpm.replaceChildren(...(s && s.bpm ? [String(s.bpm), ...(bpmEst ? [estTag()] : [])] : [dash()]));
  cells.key.replaceChildren(...(s && s.key ? [formatKey(s.key), ...(keyEst ? [estTag()] : [])] : [dash()]));
  const cam = s && s.key ? toCamelot(s.key) : null;
  cells.cam.replaceChildren(cam ? el('span', { class: 'cam' }, cam) : dash());

  // Source badge: primary source, plus a note when the key came from local analysis.
  const src = (s && s.source) || 'none';
  const badges = [el('span', { class: `badge ${src === 'error' ? 'none' : src}`, title: s && s.error ? s.error : '' }, SRC_LABEL[src] || src)];
  if (s && s.keySource === 'local' && s.bpmSource && s.bpmSource !== 'local') {
    badges.push(' ', el('span', { class: 'badge local', title: 'Key estimated from the 30 s preview' }, 'key est.'));
  }
  cells.src.replaceChildren(...badges);
  updateProgress();
}

function updateProgress() {
  const total = albumState.tracks.length;
  if (!total) return;
  const done = albumState.tracks.filter((t) => albumState.stats.has(t.id)).length;
  const withBpm = albumState.tracks.filter((t) => albumState.stats.get(t.id)?.bpm).length;
  const withKey = albumState.tracks.filter((t) => albumState.stats.get(t.id)?.key).length;
  $('albumProgress').textContent =
    done < total
      ? `Looking up stats… ${done}/${total}`
      : `${withBpm}/${total} with BPM · ${withKey}/${total} with key`;
}

/* ---------------- Stats queue (max 3 concurrent) ---------------- */

const statsQueue = (() => {
  const MAX = 3;
  let queue = [];
  let running = 0;
  const pump = () => {
    while (running < MAX && queue.length) {
      const job = queue.shift();
      running++;
      job().finally(() => {
        running--;
        pump();
      });
    }
  };
  return {
    add(job) {
      queue.push(job);
      pump();
    },
    clear() {
      queue = [];
    },
  };
})();

/* ---------------- Preview playback ---------------- */

const player = $('player');
let playingBtn = null;

function playIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', 'M7 4.5v15l13-7.5z');
  p.setAttribute('fill', 'currentColor');
  svg.append(p);
  return svg;
}
function pauseIcon() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', 'M6 4h4v16H6zM14 4h4v16h-4z');
  p.setAttribute('fill', 'currentColor');
  svg.append(p);
  return svg;
}

function stopPlayback() {
  player.pause();
  if (playingBtn) {
    playingBtn.classList.remove('playing');
    playingBtn.replaceChildren(playIcon());
  }
  playingBtn = null;
}

function togglePlay(t, btn) {
  if (playingBtn === btn) return stopPlayback();
  stopPlayback();
  player.src = t.preview;
  player.play().catch(() => stopPlayback());
  playingBtn = btn;
  btn.classList.add('playing');
  btn.replaceChildren(pauseIcon());
}
player.addEventListener('ended', stopPlayback);
player.addEventListener('error', stopPlayback);

/* ---------------- Settings ---------------- */

let hasKey = false;

async function refreshSettings() {
  const s = await api.getSettings();
  hasKey = s.hasApiKey;
  $('keyBanner').hidden = hasKey;
}

function openSettings() {
  $('apiKeyInput').value = '';
  $('apiKeyInput').placeholder = hasKey ? '•••••••• (key saved; paste to replace)' : 'Paste your key';
  $('keyState').replaceChildren(hasKey ? el('span', { class: 'key-ok' }, '✓ Key saved') : el('span', { class: 'muted' }, 'No key saved'));
  $('removeKeyBtn').hidden = !hasKey;
  $('settingsDialog').showModal();
  $('apiKeyInput').focus();
}

$('settingsBtn').addEventListener('click', openSettings);
$('bannerSettings').addEventListener('click', openSettings);
$('settingsDialog').addEventListener('close', async () => {
  if ($('settingsDialog').returnValue !== 'save') return;
  const v = $('apiKeyInput').value.trim();
  // Empty input keeps an existing key; removing is the explicit "Remove key" button.
  if (v) {
    await api.setApiKey(v);
    authWarned = false;
  }
  await refreshSettings();
});
$('removeKeyBtn').addEventListener('click', async () => {
  await api.setApiKey('');
  await refreshSettings();
  $('settingsDialog').close('cancel');
});
$('clearCacheBtn').addEventListener('click', async () => {
  await api.clearCache();
  albumState.stats.clear();
  $('clearCacheBtn').textContent = 'Cleared';
  setTimeout(() => ($('clearCacheBtn').textContent = 'Clear cache'), 1500);
});

let authWarned = false;
function showAuthError(msg) {
  if (authWarned) return;
  authWarned = true;
  setStatus('albumStatus', `${msg}. Check your key in Settings; falling back to estimates.`, true);
}

/* ---------------- Utils ---------------- */

function setStatus(id, text, isError = false) {
  const n = $(id);
  n.textContent = text;
  n.classList.toggle('error', !!isError);
}

refreshSettings();
show(stack[0]);
