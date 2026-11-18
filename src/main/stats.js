// Stats resolver.
// Every provider implements:
//   getStats({ deezerTrackId, title, artist, isrc, previewUrl })
//     -> { bpm, key, source, confidence } | null
// Order: cache -> GetSongBPM -> Deezer bpm (BPM only) -> local analysis -> null.
// To add a paid source later, create providers/<name>.js and put it in the chain below.

const CACHE_VERSION = 1;

function createResolver({ cache, providers, hasApiKey, log = console }) {
  const inflight = new Map();

  function fromCache(trackId) {
    const hit = cache.get(String(trackId));
    if (!hit || hit.v !== CACHE_VERSION) return undefined;
    // An entry resolved before a GetSongBPM key existed is upgradeable: retry it once a key is set.
    if (!hit.gsbTried && hasApiKey() && hit.source !== 'getsongbpm') return undefined;
    return hit;
  }

  async function tryProvider(p, input) {
    try {
      return await p.getStats(input);
    } catch (err) {
      log.warn(`[stats] ${p.name} failed for ${input.deezerTrackId}: ${err.message}`);
      return null;
    }
  }

  async function resolve(input) {
    const { getsongbpm, deezer, local } = providers;
    let gsbTried = hasApiKey();
    let authError = null;

    let primary = null;
    if (gsbTried) {
      try {
        primary = await getsongbpm.getStats(input);
      } catch (err) {
        // Bad key, network blip or rate limit: treat as "not tried" so it's retried later.
        gsbTried = false;
        if (err && err.code === 'AUTH') authError = err.message;
        else log.warn(`[stats] getsongbpm failed for ${input.deezerTrackId}: ${err.message}`);
      }
    }

    // A previous fallback result (from before a key existed) is reused instead of re-analysing.
    const prevRaw = cache.get(String(input.deezerTrackId));
    const prev = prevRaw && prevRaw.v === CACHE_VERSION ? prevRaw : null;
    const prevAsProvider = (field) =>
      prev && prev[field] ? { [field]: prev[field], source: prev[field + 'Source'] || prev.source, confidence: 'low' } : null;

    let result = primary;
    if (!result || !result.bpm || !result.key) {
      // Fill the gaps: Deezer gives BPM only; local analysis gives both (estimated).
      let dz = null;
      let loc = null;
      if (prev) {
        const pb = prevAsProvider('bpm');
        const pk = prevAsProvider('key');
        dz = pb && pb.source === 'deezer' ? pb : null;
        loc = { bpm: pb && pb.source === 'local' ? pb.bpm : null, key: pk ? pk.key : null, source: 'local', confidence: 'low' };
      } else {
        dz = result && result.bpm ? null : await tryProvider(deezer, input);
        const needLocal = !(result && result.key) || !((result && result.bpm) || (dz && dz.bpm));
        loc = needLocal ? await tryProvider(local, input) : null;
      }

      const bpmFrom = (result && result.bpm && result) || (dz && dz.bpm && dz) || (loc && loc.bpm && loc) || null;
      const keyFrom = (result && result.key && result) || (loc && loc.key && loc) || null;
      if (bpmFrom || keyFrom) {
        result = {
          ...(result || {}),
          bpm: bpmFrom ? bpmFrom.bpm : null,
          key: keyFrom ? keyFrom.key : null,
          source: (bpmFrom || keyFrom).source,
          bpmSource: bpmFrom ? bpmFrom.source : null,
          keySource: keyFrom ? keyFrom.source : null,
          confidence: (bpmFrom || keyFrom).confidence,
        };
      } else {
        result = null;
      }
    } else {
      result = { ...result, bpmSource: result.source, keySource: result.source };
    }

    const entry = result
      ? { v: CACHE_VERSION, ...result, gsbTried, at: Date.now() }
      : { v: CACHE_VERSION, bpm: null, key: null, source: 'none', gsbTried, at: Date.now() };
    // Entries with gsbTried=false are retried automatically once GetSongBPM is reachable with a key.
    cache.set(String(input.deezerTrackId), entry);
    return authError ? { ...entry, authError } : entry;
  }

  return {
    /** Synchronous cache read for a batch of ids: { [id]: entry } */
    cached(ids) {
      const out = {};
      for (const id of ids) {
        const hit = fromCache(id);
        if (hit) out[id] = hit;
      }
      return out;
    },
    get(input) {
      const hit = fromCache(input.deezerTrackId);
      if (hit) return Promise.resolve(hit);
      const k = String(input.deezerTrackId);
      if (!inflight.has(k)) {
        inflight.set(k, resolve(input).finally(() => inflight.delete(k)));
      }
      return inflight.get(k);
    },
  };
}

module.exports = { createResolver };
