// Deezer browse API: artist search, discography, album tracks.
const { deezerJson } = require('./http');

// In-memory memo so going back and forth within a session doesn't refetch.
const memo = new Map();
async function memoized(key, fn) {
  if (memo.has(key)) return memo.get(key);
  const p = fn().catch((err) => {
    memo.delete(key);
    throw err;
  });
  memo.set(key, p);
  return p;
}

async function searchArtists(query) {
  const q = String(query || '').trim();
  if (!q) return [];
  const json = await deezerJson(`/search/artist?q=${encodeURIComponent(q)}&limit=25`);
  return (json.data || []).map((a) => ({
    id: a.id,
    name: a.name,
    picture: a.picture_medium,
    fans: a.nb_fan,
  }));
}

function normTitle(t) {
  return String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function getArtistAlbums(artistId) {
  return memoized(`albums:${artistId}`, async () => {
    const [artist, first] = await Promise.all([
      deezerJson(`/artist/${artistId}`),
      deezerJson(`/artist/${artistId}/albums?limit=100`),
    ]);
    const all = [...(first.data || [])];
    let next = first.next;
    for (let page = 0; next && page < 20; page++) {
      const json = await deezerJson(next);
      all.push(...(json.data || []));
      next = json.next;
    }

    // Deezer often lists explicit/clean (and regional) editions separately: dedupe by title + type.
    const seen = new Set();
    const albums = [];
    for (const a of all) {
      const key = `${a.record_type}|${normTitle(a.title)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      albums.push({
        id: a.id,
        title: a.title,
        cover: a.cover_medium,
        year: a.release_date ? a.release_date.slice(0, 4) : '',
        releaseDate: a.release_date || '',
        type: a.record_type, // album | ep | single | compile
      });
    }
    albums.sort((x, y) => y.releaseDate.localeCompare(x.releaseDate));

    return {
      artist: { id: artist.id, name: artist.name, picture: artist.picture_medium, fans: artist.nb_fan },
      albums,
    };
  });
}

function getAlbum(albumId) {
  return memoized(`album:${albumId}`, async () => {
    const a = await deezerJson(`/album/${albumId}`);
    let tracks = [...((a.tracks && a.tracks.data) || [])];
    // Albums over 25 tracks paginate.
    let next = a.tracks && a.tracks.next;
    for (let page = 0; next && page < 20; page++) {
      const json = await deezerJson(next);
      tracks.push(...(json.data || []));
      next = json.next;
    }
    return {
      id: a.id,
      title: a.title,
      cover: a.cover_medium,
      year: a.release_date ? a.release_date.slice(0, 4) : '',
      artist: a.artist && a.artist.name,
      tracks: tracks.map((t, i) => ({
        id: t.id,
        // The album track list omits track_position; list order is the track order.
        position: t.track_position || i + 1,
        title: t.title,
        duration: t.duration,
        preview: t.preview || null, // signed URL that expires: never cache to disk
        artist: (t.artist && t.artist.name) || (a.artist && a.artist.name) || '',
      })),
    };
  });
}

/** Track detail: weak BPM source + ISRC. Not memoized (results land in the stats cache). */
async function getTrack(trackId) {
  const t = await deezerJson(`/track/${trackId}`);
  return { id: t.id, bpm: t.bpm, isrc: t.isrc, preview: t.preview };
}

module.exports = { searchArtists, getArtistAlbums, getAlbum, getTrack };
