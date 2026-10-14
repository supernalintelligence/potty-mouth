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

// Separator allowed between two fuzzy-matched letters. Whitespace-tolerant,
// since real evasion spaces letters out ("f u c k") -- see the fuzzy-root
// sanity test suite. Excludes closing delimiters ()]}"'`) -- these almost
// always terminate a real preceding token rather than serving as mid-word
// evasion punctuation, so allowing them let SEP bridge across a genuine
// word boundary. Confirmed 2026-08-23: "DB(s) hit" matched the "shit" root
// (s -> the literal 's' in "(s)", SEP -> ") ", h/i/t -> the unrelated next
// word "hit") -- the same class of bug as the 2026-08-20 TIGHT_SEP fix
// below, just via the plain-letter SEP path instead of the mask-substitution
// path. No existing obfuscation pattern (f*ck, sh!t, f.u.c.k, f u c k, etc.)
// uses a closing delimiter as a separator, so this excludes nothing real.
const SEP = '[^\\w)\\]}"\'`]{0,2}';
// Separator allowed ONLY right after a MASK symbol has stood in for a whole
// letter (f*ck, sh!t). Punctuation-only, no whitespace: real obfuscation
// packs the substitute symbol tight against its neighbors, never leaving a
// real word-gap after it. Without this split, ordinary prose punctuation
// followed by a space (a numbered list item, "5. it") can read as
// "leet-digit letter, mask-substituted letter, then a normal word-gap" --
// an accidental match for a real fuzzy root. Confirmed 2026-08-20: "5. it"
// matched "shit" (5->s, "."->mask-for-h, " "->separator, "it"->i+t).
const TIGHT_SEP = '[^\\w\\s]{0,1}';

function fuzzyWord(word) {
  const chars = word.split('');
  const last = chars.length - 1;
  return chars
    .map((ch, i) => {
      const base = LEET[ch.toLowerCase()] || escapeRegex(ch);
      const isInterior = i > 0 && i < last;
      const trailingSep = i < last ? SEP : '';
      if (!isInterior) return `(?:${base})${trailingSep}`;
      const trailingTightSep = i < last ? TIGHT_SEP : '';
      return `(?:(?:${base})${trailingSep}|(?:${MASK})${trailingTightSep})`;
    })
    .join('');
}

export function buildStrictMatcher(words) {
  const sortedWords = Object.keys(words).sort((a, b) => b.length - a.length);
  return new RegExp('\\b(' + sortedWords.map(escapeRegex).join('|') + ')\\b', 'gi');
}

// Trailing suffix a fuzzy root is allowed to be followed by and still count
// as a match — e.g. "f*ck" + "ing" (a real conjugation). An UNBOUNDED
// trailing \w* (the original design) would also let "cock" + "pit" match,
// which is how cockpit/cocktail/dickens/prickly false-positived (2026-08-09)
// even for roots later removed from SEED_FUZZY_ROOTS — this bound is
// defense in depth for any root added in the future, not just today's.
// Ends with a real \b so an unrecognized suffix (anything not in this list)
// can never complete the match. Includes "ty" for the double-consonant
// conjugation of roots ending in a single consonant (shit -> shitty,
// slut -> slutty — "y" alone only spells the single-consonant misspelling).
const FUZZY_SUFFIX = '(?:ing|ings|ers?|ed|heads?|holes?|ups?|ty|y|s)?\\b';

export function buildFuzzyMatcher(roots) {
  return new RegExp('\\b(?:' + roots.map(fuzzyWord).join('|') + ')' + FUZZY_SUFFIX, 'i');
}

// A fuzzy match that SPANS WHITESPACE ("sh it") and starts right after '.', '/', '\' or '-' is a
// file extension, a path or a flag followed by a word ("runme.sh it should work", "-sh it"), not
// a spaced-out evasion. Matches without internal whitespace ("f*ck", "ok.f*ck it", "no-sh!t",
// "f.u.c.k") are still caught after any of those characters, so obfuscation is not hidden by
// prefixing it with punctuation. Plain forms are caught by the strict matcher regardless.
function fuzzyHit(text, roots) {
  const re = new RegExp(buildFuzzyMatcher(roots).source, 'gi');
  let m;
  while ((m = re.exec(text)) !== null) {
    const prev = m.index > 0 ? text[m.index - 1] : '';
    if (prev !== '' && './\\-'.includes(prev) && /\s/.test(m[0])) {
      re.lastIndex = m.index + 1;
      continue;
    }
    return true;
  }
  return false;
}

// A hit on EITHER matcher blocks. Strict alone already covers every plain
// (non-obfuscated) instance of every table word, including short ones —
// fuzzy only adds obfuscation tolerance for the curated root subset.
export function detect(text, words, fuzzyRoots = []) {
  if (!text || typeof text !== 'string') return false;
  if (buildStrictMatcher(words).test(text)) return true;
  if (fuzzyRoots.length > 0 && fuzzyHit(text, fuzzyRoots)) return true;
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
