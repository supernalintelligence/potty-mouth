// Obfuscation-tolerant word matching. Same technique as the transcript
// cleaner this was ported from: strict word boundaries (so "class" is never
// touched for containing "ass" — no Scunthorpe problem), leetspeak-aware,
// tolerant of a single mask symbol or separator between interior letters
// (f*ck, sh!t, f.u.c.k) but not the first/last letter of a word.
const LEET = {
  a: '[a@4]', b: '[b8]', e: '[e3]', g: '[g9]', i: '[i1!|]', l: '[l1|]',
  o: '[o0]', s: '[s$5]', t: '[t7]', u: '[uv]',
};
const MASK = '[*#@!$%&._+-]';

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fuzzyWord(word) {
  const chars = word.split('');
  return chars
    .map((ch, i) => {
      const base = LEET[ch.toLowerCase()] || escapeRegex(ch);
      const isInterior = i > 0 && i < chars.length - 1;
      return isInterior ? `(?:${base}|${MASK})` : `(?:${base})`;
    })
    .join('[\\W_]{0,2}');
}

// Builds a case-insensitive matcher for the given word table. Returns both a
// strict exact matcher (used for the deterministic swap) and a fuzzy
// detector (used for block/detect decisions, since a hard block only needs
// to know something matched, not clean-replace it in place).
export function buildMatchers(words) {
  const sortedWords = Object.keys(words).sort((a, b) => b.length - a.length);
  const strict = new RegExp('\\b(' + sortedWords.map(escapeRegex).join('|') + ')\\b', 'gi');
  const fuzzy = new RegExp(
    '\\b(?:' + sortedWords.map(fuzzyWord).join('|') + ')\\w*',
    'i',
  );
  return { strict, fuzzy };
}

export function detect(text, words) {
  if (!text || typeof text !== 'string') return false;
  const { fuzzy } = buildMatchers(words);
  return fuzzy.test(text);
}

function applyCase(original, replacement, removedToken) {
  if (replacement === removedToken) return removedToken;
  if (original === original.toUpperCase() && original.length > 1) return replacement.toUpperCase();
  if (original[0] === original[0].toUpperCase() && original[1] === original[1]?.toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

// Deterministic, strict-word-boundary swap only (no fuzzy rewrite in place —
// fuzzy is for detection; blindly rewriting an obfuscated match risks
// mangling text the same way whole-message LLM rewrites did elsewhere).
export function cleanText(text, words, removedToken) {
  const { strict } = buildMatchers(words);
  let changed = false;
  let swaps = 0;
  const result = text.replace(strict, (match) => {
    const repl = words[match.toLowerCase()];
    if (repl === undefined) return match;
    changed = true;
    swaps++;
    return applyCase(match, repl, removedToken);
  });
  return { changed, swaps, text: result };
}
