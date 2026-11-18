// Worker thread: decode a 30s MP3 preview and estimate BPM + key with essentia.js.
import { parentPort } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { MPEGDecoder } from 'mpg123-decoder';

const require = createRequire(import.meta.url);
const { Essentia, EssentiaWASM } = require('essentia.js');
const essentia = new Essentia(EssentiaWASM);

const decoder = new MPEGDecoder();
const decoderReady = decoder.ready;

function toMono(channelData) {
  if (channelData.length === 1) return channelData[0];
  const [l, r] = channelData;
  const out = new Float32Array(l.length);
  for (let i = 0; i < l.length; i++) out[i] = (l[i] + r[i]) * 0.5;
  return out;
}

// Linear resample to 44100 Hz (RhythmExtractor2013 assumes 44.1k).
function resample(signal, from, to) {
  if (from === to) return signal;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(signal.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio, i0 = Math.floor(x), f = x - i0;
    out[i] = signal[i0] * (1 - f) + (signal[i0 + 1] ?? signal[i0]) * f;
  }
  return out;
}

async function analyze(mp3Bytes) {
  await decoderReady;
  await decoder.reset();
  const { channelData, sampleRate, samplesDecoded } = decoder.decode(new Uint8Array(mp3Bytes));
  if (!samplesDecoded) throw new Error('decode produced no samples');
  const mono = resample(toMono(channelData), sampleRate, 44100);

  const vec = essentia.arrayToVector(mono);
  const rhythm = essentia.RhythmExtractor2013(vec, 208, 'multifeature', 40);
  const key = essentia.KeyExtractor(vec, true, 4096, 4096, 12, 3500, 60, 25, 0.2, 'bgate', 44100, 0.0001, 440, 'cosine', 'hann');
  vec.delete?.();

  let bpm = rhythm.bpm;
  // Half/double-time correction per handover: fold into 70–180.
  while (bpm && bpm < 70) bpm *= 2;
  while (bpm > 180) bpm /= 2;

  return {
    bpm: bpm ? Math.round(bpm) : null,
    key: key.key ? key.key + (key.scale === 'minor' ? 'm' : '') : null,
    keyStrength: key.strength,
  };
}

parentPort.on('message', async ({ id, bytes }) => {
  try {
    parentPort.postMessage({ id, result: await analyze(bytes) });
  } catch (err) {
    parentPort.postMessage({ id, error: String(err?.message || err) });
  }
});
