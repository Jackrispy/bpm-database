// GetSongBPM provider (primary). Free key; matching is by normalised artist + title.
// Docs: https://getsongbpm.com/api  — free tier requires a visible backlink (see footer in the UI).
const { fetchWithTimeout } = require('../http');
const { artistsMatch, titlesMatch, normalizeTitle } = require('../normalize');

const BASE = 'https://api.getsong.co';

function create({ getApiKey }) {
  async function call(pathname, params) {
    const key = getApiKey();
    const url = new URL(pathname, BASE);
    url.searchParams.set('api_key', key);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetchWithTimeout(url, { headers: { 'X-API-KEY': key } });
    if (res.status === 401 || res.status === 403) {
      const err = new Error('GetSongBPM rejected the API key');
      err.code = 'AUTH';
      throw err;
    }
    if (!res.ok) throw new Error(`GetSongBPM HTTP ${res.status}`);
    return res.json();
  }

  // Search results come back as { search: [...] } or { search: { error: "no result" } }.
  function results(json) {
    return Array.isArray(json && json.search) ? json.search : [];
  }

  function pick(list, title, artist) {
    return list.find((s) => s && s.artist && artistsMatch(s.artist.name, artist) && titlesMatch(s.title, title));
  }

  async function getStats({ title, artist }) {
    if (!getApiKey()) return null;
    const cleanTitle = normalizeTitle(title);

    // 1) Combined song + artist lookup.
    let match = pick(
      results(await call('/search/', { type: 'both', lookup: `song:${cleanTitle} artist:${artist}` })),
      title,
      artist,
    );
    // 2) Fallback: title-only search, filter by artist ourselves.
    if (!match) {
      match = pick(results(await call('/search/', { type: 'song', lookup: cleanTitle })), title, artist);
    }
    if (!match) return null;

    // Search hits normally carry tempo/key; if not, fetch the song record.
    let song = match;
    if (!song.tempo && song.id) {
      const json = await call('/song/', { id: song.id });
      song = (json && json.song) || song;
    }

    const bpm = parseInt(song.tempo, 10);
    const key = song.key_of ? String(song.key_of).trim() : null;
    if (!(bpm > 0) && !key) return null;
    return {
      bpm: bpm > 0 ? bpm : null,
      key: key || null,
      timeSig: song.time_sig || null,
      openKey: song.open_key || null,
      source: 'getsongbpm',
      confidence: 'high',
    };
  }

  return { name: 'getsongbpm', getStats };
}

module.exports = { create };
