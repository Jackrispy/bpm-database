// Name normalisation for matching Deezer tracks against GetSongBPM (no ISRC there).

function base(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/&/g, ' and ');
}

function finish(s) {
  return s
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const VERSION_WORDS =
  'remaster(?:ed)?|live|radio edit|edit|single version|album version|mono|stereo|version|mix|remix|bonus track|explicit|clean|deluxe|from|soundtrack';

function normalizeTitle(title) {
  let s = base(title);
  // Bracketed groups holding a feature credit or a version tag, anywhere inside:
  // (feat. X), [ft. X], (with X), (Radio Edit - feat. X), [2009 Remaster], (Live at ...)
  s = s.replace(/[([]\s*with\s[^)\]]*[)\]]/g, ' ');
  s = s.replace(new RegExp(`[([][^)\\]]*\\b(feat\\.?|ft\\.?|featuring|${VERSION_WORDS})(?![a-z])[^)\\]]*[)\\]]`, 'g'), ' ');
  // Unbracketed "feat. X" to the end
  s = s.replace(/\s(feat\.?|ft\.?|featuring)\s.*$/g, ' ');
  // " - Remastered 2011", " - Live", " - Radio Edit" suffixes
  s = s.replace(new RegExp(`\\s-\\s.*\\b(${VERSION_WORDS})\\b.*$`), ' ');
  return finish(s);
}

function normalizeArtist(name) {
  let s = base(name);
  s = s.replace(/\s(feat\.?|ft\.?|featuring|with|x|vs\.?)\s.*$/g, ' ');
  s = s.replace(/^the\s+/, '');
  return finish(s);
}

function artistsMatch(a, b) {
  const x = normalizeArtist(a);
  const y = normalizeArtist(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // "Daft Punk" vs "Daft Punk, Pharrell Williams" etc.
  return x.startsWith(y + ' ') || y.startsWith(x + ' ');
}

function titlesMatch(a, b) {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  return !!x && x === y;
}

module.exports = { normalizeTitle, normalizeArtist, artistsMatch, titlesMatch };
