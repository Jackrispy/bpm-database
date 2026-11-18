// Local analysis provider (fallback): decode the Deezer 30 s preview and estimate
// BPM + key with essentia.js in a worker thread so the main process never blocks.
const path = require('path');
const { Worker } = require('worker_threads');
const { fetchWithTimeout } = require('../http');
const deezer = require('../deezer');

const JOB_TIMEOUT_MS = 30000;

function create() {
  let worker = null;
  let nextId = 1;
  const pending = new Map();
  // One analysis at a time: essentia is CPU-bound and single-threaded per worker.
  let chain = Promise.resolve();

  function failAll(err) {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(err);
    }
    pending.clear();
  }

  function getWorker() {
    if (worker) return worker;
    worker = new Worker(path.join(__dirname, 'analyze-worker.mjs'));
    worker.on('message', ({ id, result, error }) => {
      const job = pending.get(id);
      if (!job) return;
      pending.delete(id);
      clearTimeout(job.timer);
      error ? job.reject(new Error(error)) : job.resolve(result);
    });
    worker.on('error', (err) => {
      failAll(err);
      worker = null;
    });
    worker.on('exit', () => {
      failAll(new Error('analysis worker exited'));
      worker = null;
    });
    return worker;
  }

  function analyze(bytes) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('local analysis timed out'));
        // A stuck worker is useless; restart it next time.
        if (worker) worker.terminate();
      }, JOB_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      getWorker().postMessage({ id, bytes }, [bytes]);
    });
  }

  async function getStats({ deezerTrackId, previewUrl }) {
    let url = previewUrl;
    if (!url) url = (await deezer.getTrack(deezerTrackId)).preview;
    if (!url) return null;

    let res = await fetchWithTimeout(url, {}, 20000);
    // Preview URLs are signed and expire: refresh once from the track endpoint.
    if (!res.ok && previewUrl) {
      url = (await deezer.getTrack(deezerTrackId)).preview;
      if (!url) return null;
      res = await fetchWithTimeout(url, {}, 20000);
    }
    if (!res.ok) throw new Error(`preview HTTP ${res.status}`);
    const bytes = await res.arrayBuffer();

    const run = chain.then(() => analyze(bytes));
    chain = run.catch(() => {});
    const out = await run;
    if (!out || (!out.bpm && !out.key)) return null;
    return { bpm: out.bpm, key: out.key, source: 'local', confidence: 'low' };
  }

  function dispose() {
    if (worker) worker.terminate();
  }

  return { name: 'local', getStats, dispose };
}

module.exports = { create };
