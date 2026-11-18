// Key -> Camelot wheel. Accepts "Am", "A minor", "F#", "Gb", "E♭m", "C# major", etc.
// Derived from pitch class on the circle of fifths: C major = 8B, A minor = 8A.

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function parseKey(raw) {
  if (!raw) return null;
  const s = String(raw).trim().replace(/♯/g, '#').replace(/♭/g, 'b');
  const m = s.match(/^([A-Ga-g])\s*([#b]?)\s*(m|min|minor|maj|major)?$/);
  if (!m) return null;
  let pc = PC[m[1].toUpperCase()];
  if (m[2] === '#') pc += 1;
  if (m[2] === 'b') pc -= 1;
  pc = (pc + 12) % 12;
  const minor = !!m[3] && /^m(in(or)?)?$/i.test(m[3]) && m[3] !== 'maj' && !/^maj/i.test(m[3]);
  return { pc, minor };
}

function camelotNumber(majorPc) {
  // Each step of a fifth (7 semitones) moves one hour on the wheel; C (0) sits at 8.
  return (((majorPc * 7) % 12) + 7) % 12 + 1;
}

export function toCamelot(raw) {
  const k = parseKey(raw);
  if (!k) return null;
  if (k.minor) return camelotNumber((k.pc + 3) % 12) + 'A'; // relative major shares the number
  return camelotNumber(k.pc) + 'B';
}

const NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Normalised display form, e.g. "A♭m" stays readable; unparseable input is returned as-is. */
export function formatKey(raw) {
  const k = parseKey(raw);
  if (!k) return raw || '';
  // Prefer the spelling the source used when it has an accidental.
  const usedFlat = /b|♭/.test(String(raw).slice(1, 2));
  const name = (usedFlat ? NAMES_FLAT : NAMES_SHARP)[k.pc];
  return name + (k.minor ? 'm' : '');
}
