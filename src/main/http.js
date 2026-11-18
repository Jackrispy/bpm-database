// Shared HTTP helpers for the main process.
// Deezer allows ~50 requests / 5 s; we stay under that with a sliding-window limiter.

const DEEZER_MAX = 40;
const DEEZER_WINDOW_MS = 5000;
const deezerStamps = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function deezerSlot() {
  for (;;) {
    const now = Date.now();
    while (deezerStamps.length && now - deezerStamps[0] > DEEZER_WINDOW_MS) deezerStamps.shift();
    if (deezerStamps.length < DEEZER_MAX) {
      deezerStamps.push(now);
      return;
    }
    await sleep(DEEZER_WINDOW_MS - (now - deezerStamps[0]) + 10);
  }
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** GET a Deezer API path (or full URL) as JSON, throttled, retrying on quota errors. */
async function deezerJson(pathOrUrl) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `https://api.deezer.com${pathOrUrl}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    await deezerSlot();
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`Deezer HTTP ${res.status}`);
    const json = await res.json();
    // Deezer returns 200 with an error body; code 4 = quota exceeded.
    if (json && json.error) {
      if (json.error.code === 4) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      throw new Error(`Deezer: ${json.error.message || json.error.type}`);
    }
    return json;
  }
  throw new Error('Deezer: rate limit retries exhausted');
}

module.exports = { deezerJson, fetchWithTimeout, sleep };
