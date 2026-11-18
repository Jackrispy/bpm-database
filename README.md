# BPM Database

Desktop app (Electron + vanilla JS): search artist → pick album → track table with BPM, key, Camelot and source.

BPM and key data provided by [GetSongBPM](https://getsongbpm.com). Catalogue and previews from [Deezer](https://www.deezer.com).

## Run

```
npm install
npm start
```

Optional: open **Settings** (gear icon) and paste a free GetSongBPM API key from https://getsongbpm.com/api. Without a key, stats come from Deezer's `bpm` field and local analysis of the 30 s preview (shown as `est.`).

## How stats are resolved

`src/main/stats.js`: cache → GetSongBPM → Deezer `bpm` (BPM only) → local preview analysis → nothing.
Gaps are filled per field: e.g. BPM from Deezer + key estimated locally ("Deezer" + "key est." badges).

Every provider in `src/main/providers/` has the same shape:

```js
getStats({ deezerTrackId, title, artist, isrc, previewUrl }) // -> { bpm, key, source, confidence } | null
```

To add a paid source later, add a provider file and insert it in the chain in `stats.js`; the UI doesn't change.

## Layout

| Path | What |
|---|---|
| `src/main/main.js` | Window, IPC handlers, settings/cache stores |
| `src/main/deezer.js` | Deezer browse API (search, discography with dedupe, album tracks) |
| `src/main/http.js` | Deezer rate limiter (40 req / 5 s) + quota retry |
| `src/main/stats.js` | Resolver chain + cache logic |
| `src/main/providers/` | `getsongbpm.js`, `deezer.js`, `local.js` + `analyze-worker.mjs` (mpg123 decode + essentia.js in a worker thread) |
| `src/main/normalize.js` | Title/artist normalisation for name matching |
| `src/renderer/` | UI: `index.html`, `styles.css`, `app.js`, `camelot.js` |

Data lives in `%APPDATA%\bpm-database\`: `stats-cache.json` (keyed by Deezer track ID) and `settings.json` (API key).

## Notes

- Cache entries resolved before a GetSongBPM key existed are retried automatically once a key is added, reusing the earlier local result rather than re-analysing.
- Local BPM is folded into 70–180 to fix half/double-time; local key from 30 s is the least reliable stat.
- GetSongBPM's free tier requires the visible backlink; it's in the footer.
