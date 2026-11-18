# Handover — Artist → Album → Track Stats App (v1)

## Goal
Desktop app with this flow:
**Search artist → pick artist → see all their albums → pick album → table of tracks with BPM + key.**

Personal use. Free data sources only for v1.

---

## Decisions made
- **Spotify Web API is NOT used for stats.** `GET /v1/audio-features` returns 403 for any app created after 27 Nov 2024. The data still exists (Spotify Mix uses it via the internal client API), but scraping that breaks the ToS and is fragile, so it's out of scope for v1.
- **Browse data:** Deezer public API (no auth, free).
- **Stats, primary:** GetSongBPM API (free, BPM + key, lookup by name).
- **Stats, fallback:** local analysis of the Deezer 30s preview MP3 when GetSongBPM has no match.
- **Stats source must be swappable** (one interface), so a paid source (SoundStat / Soundcharts / Apify Spotify scraper) can be added later without touching the UI.

## Suggested stack (not locked in)
- **Electron + vanilla JS or React**, Windows target.
- All HTTP calls go through the **main process** (Deezer has no CORS headers, so renderer fetches fail). Expose them through `ipcMain.handle` / preload `contextBridge`.
- Local analysis: **essentia.js** (WASM) running in the renderer. Decode the preview with `AudioContext.decodeAudioData`, then run `RhythmExtractor2013` (BPM) and `KeyExtractor` (key + scale). Keeps everything JS, with no Python sidecar.
- Cache: a simple JSON file or `better-sqlite3` in `app.getPath('userData')`, keyed by Deezer track ID.

---

## Data sources

### Deezer (browse) — https://api.deezer.com
No key needed. Rate limit is about **50 requests per 5 seconds**, so throttle.

| Step | Endpoint | Notes |
|---|---|---|
| Search artist | `GET /search/artist?q={query}` | `data[]`: `id`, `name`, `picture_medium`, `nb_fan` |
| Artist albums | `GET /artist/{id}/albums?limit=100` | Paginated via `next`. Includes singles/EPs; filter on `record_type` (`album`, `ep`, `single`, `compile`) |
| Album + tracks | `GET /album/{id}` | `tracks.data[]`: `id`, `title`, `duration`, `track_position`, `preview` (30s MP3 URL), `artist.name` |
| Track detail | `GET /track/{id}` | Has `bpm` (often 0 or missing) and `isrc`. Use `bpm` only if > 0, as a weak extra source |

Dedupe albums by lowercased title, since Deezer often lists explicit and clean versions separately.

### GetSongBPM (stats primary) — https://getsongbpm.com/api
- Base URL: `https://api.getsong.co/`
- Key goes in the `api_key` query param or an `X-API-KEY` header. Register for a free key.
- **The free tier requires a visible backlink to GetSongBPM.com** in the app (an About screen or a footer link is fine).
- Search: `GET /search/?type=both&lookup=song:{title}artist:{artist}`. **Check the exact lookup syntax against the docs before coding**; it's unusual.
- Fields used: `tempo` (int BPM), `key_of` (e.g. "Em"), `time_sig`, `open_key`.
- No ISRC, so matching is by name. Normalise both sides first: lowercase; strip `(feat. …)`, `- Remastered 20xx`, `- Live`, `(Radio Edit)` and punctuation. Accept a match only if the artist matches and the title matches after normalising.

### Local analysis (stats fallback)
- Input: Deezer `preview` URL (30s MP3).
- BPM from 30s is usually fine. Watch for half/double-time errors: if the result is under 70 or over 180, consider halving or doubling it.
- Key from 30s is the least reliable stat, so mark these values as "estimated" in the UI.

---

## Stats provider interface
```js
// providers/*.js
// returns { bpm: number|null, key: string|null, source: 'getsongbpm'|'deezer'|'local', confidence: 'high'|'low' } or null
async function getStats({ deezerTrackId, title, artist, isrc, previewUrl }) {}
```
Resolution order: **cache → GetSongBPM → Deezer `bpm` (if > 0, BPM only) → local analysis → null**. Write the result to the cache.

---

## UI (v1)
1. **Search screen:** text box with a 300ms debounce, results showing artist image, name and fan count.
2. **Artist screen:** grid of album covers with title and year, plus a filter toggle for Albums / EPs / Singles.
3. **Album screen:** table with **# | Title | Duration | BPM | Key | Camelot | Source**.
   - Rows render right away. Stats fill in as they load (max 3 concurrent lookups).
   - Source badge per row; local results show as "est."
   - Optional: a play button for the 30s preview.
4. Back navigation between the screens; keep the previous screen's state.

Camelot conversion: a static map from key (e.g. `Am` → `8A`, `C` → `8B`).

---

## Out of scope for v1
- Spotify internal API, and any paid stats provider
- Energy / danceability / other audio features
- Playlists, accounts, export

## Done when
- Searching "Daft Punk" → Discovery → shows 14 tracks with BPM and key for most rows, each with a source badge.
- Reopening the same album loads instantly from the cache.
- The backlink to GetSongBPM is visible in the app.
