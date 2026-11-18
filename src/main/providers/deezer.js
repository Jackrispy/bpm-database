// Deezer track-detail provider: BPM only, weak. Deezer's `bpm` is often 0/missing.
const deezer = require('../deezer');

function create() {
  async function getStats({ deezerTrackId }) {
    const t = await deezer.getTrack(deezerTrackId);
    const bpm = Number(t.bpm);
    if (!(bpm > 0)) return null;
    return { bpm: Math.round(bpm), key: null, source: 'deezer', confidence: 'low' };
  }
  return { name: 'deezer', getStats };
}

module.exports = { create };
