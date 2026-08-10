// Two independent matchers, deliberately not merged into one:
//
//   STRICT  — full \b(word)\b boundary on both sides, built from the WHOLE
//             word table (seed + user additions). Safe for any word,
//             including short/common-prefix ones like "ass" or "hell",
//             because both boundaries must hold — "associated" never
//             matches "ass" since there's no boundary between "ass" and
//             "ociated".
//
//   FUZZY   — obfuscation-tolerant (leetspeak, mask symbols, separators —
//             f*ck, sh!t, f.u.c.k), but only anchored at the START of a
//             match, not the end (it needs a trailing \w* to still catch
//             conjugations like "fucking" from a bare "fuck" root). That
//             means a short/generic root WOULD false-positive as a bare
//             prefix of an unrelated word ("ass" inside "associated" is
//             exactly this bug — confirmed 2026-08-09). So fuzzy matching
//             only ever runs against a small, deliberately curated root
//             list (see words.mjs SEED_FUZZY_ROOTS) — never the full table.
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

export function buildStrictMatcher(words) {
  const sortedWords = Object.keys(words).sort((a, b) => b.length - a.length);
  return new RegExp('\\b(' + sortedWords.map(escapeRegex).join('|') + ')\\b', 'gi');
}

export function buildFuzzyMatcher(roots) {
  return new RegExp('\\b(?:' + roots.map(fuzzyWord).join('|') + ')\\w*', 'i');
}

// A hit on EITHER matcher blocks. Strict alone already covers every plain
// (non-obfuscated) instance of every table word, including short ones —
// fuzzy only adds obfuscation tolerance for the curated root subset.
export function detect(text, words, fuzzyRoots = []) {
  if (!text || typeof text !== 'string') return false;
  if (buildStrictMatcher(words).test(text)) return true;
  if (fuzzyRoots.length > 0 && buildFuzzyMatcher(fuzzyRoots).test(text)) return true;
  return false;
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
  const strict = buildStrictMatcher(words);
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
