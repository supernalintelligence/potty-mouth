// The word table. Word -> clean swap. Same technique proven in a sibling
// internal transcript-cleaner: single-token, case-preserving, whole-word-only
// swaps. Coarse by design; a table lookup, not a language model.
//
// REMOVED entries (hateful/gendered slurs) have no clean synonym that
// preserves meaning, so they resolve to a placeholder instead of a swap.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const REMOVED = '[removed]';

// Roots eligible for obfuscation-tolerant (fuzzy) detection. Kept small and
// curated: match.mjs's fuzzy matcher only requires a boundary at the START
// of a match plus a bounded, known-suffix allowlist at the end (see
// FUZZY_SUFFIX in match.mjs) — so a root that's ALSO a common-word prefix
// still risks a false positive even with that guard (e.g. "cock" + "y" is a
// legal suffix match, and "cocky" is an ordinary word). Confirmed false
// positives 2026-08-09: "cock" flagged cockpit/cocktail/cockroach/cocky,
// "dick" flagged dickens, "prick" flagged prickly/prickle — all three
// removed from this list for that reason (they're STILL caught via the
// strict exact-word table in SEED_WORDS below, just not obfuscation-
// tolerant). Originally ported from scripts/clean-transcripts.mjs's
// DETECT_ROOTS, which has this same latent risk. Do not add a short root
// here without checking it isn't a common-word prefix first.
export const SEED_FUZZY_ROOTS = [
  'fuck', 'shit', 'bitch', 'bastard', 'asshole',
  'cunt', 'slut', 'whore', 'faggot', 'nigger', 'nigga', 'retard', 'douche',
  'motherfucker', 'goddamn', 'bullshit',
];

export const SEED_WORDS = {
  // f-word family -> fox
  fuck: 'fox', fucks: 'foxes', fucked: 'foxed', fucking: 'foxing',
  fucker: 'foxer', fuckers: 'foxers', fuckup: 'foxup', fuckups: 'foxups',
  clusterfuck: 'clusterfox', motherfucker: 'motherfoxer', motherfuckers: 'motherfoxers',
  motherfucking: 'motherfoxing', fml: 'ugh', wtf: 'what the heck', stfu: 'quiet down',
  // s-word family
  shit: 'junk', shits: 'junk', shitty: 'lousy', shitter: 'mess',
  shitting: 'messing', bullshit: 'nonsense', bullshitting: 'fibbing',
  shitshow: 'mess', shithole: 'dump', shitload: 'ton', dogshit: 'garbage',
  horseshit: 'nonsense', batshit: 'wild',
  // ass family
  ass: 'butt', asses: 'butts', asshole: 'jerk', assholes: 'jerks',
  asshat: 'jerk', jackass: 'fool', jackasses: 'fools', dumbass: 'dummy',
  dumbasses: 'dummies', smartass: 'smart aleck', badass: 'awesome', asswipe: 'jerk',
  // b-words
  bitch: 'complainer', bitches: 'complainers', bitching: 'complaining',
  bitchy: 'cranky', bastard: 'jerk', bastards: 'jerks',
  // damn / hell
  damn: 'darn', damned: 'darned', damnit: 'darn it', dammit: 'darn it',
  goddamn: 'darn', goddamned: 'darned', goddammit: 'darn it', godamn: 'darn', hell: 'heck',
  // crap / piss
  crap: 'junk', crappy: 'lousy', crapping: 'messing', piss: 'tick',
  pissed: 'annoyed', pissing: 'annoying', pissy: 'cranky',
  // slang
  dick: 'jerk', dickhead: 'jerk', cock: 'jerk', prick: 'jerk',
  douche: 'jerk', douchebag: 'jerk', twat: 'jerk', wanker: 'jerk',
  // british
  bollocks: 'nonsense', bloody: 'darn', arse: 'butt', arsehole: 'jerk', bugger: 'darn', sod: 'darn',
  // hateful / gendered slurs -> removed, no clean synonym exists
  slut: REMOVED, sluts: REMOVED, whore: REMOVED, whores: REMOVED,
  cunt: REMOVED, cunts: REMOVED, fag: REMOVED, faggot: REMOVED,
  retard: REMOVED, retarded: REMOVED, nigger: REMOVED, nigga: REMOVED,
  spic: REMOVED, kike: REMOVED, chink: REMOVED, tranny: REMOVED,
};

function tableDir() {
  return path.join(os.homedir(), '.potty-mouth');
}

function tablePath() {
  return path.join(tableDir(), 'words.json');
}

// Only ever writes the USER's additions/overrides, never the seed table, so
// upgrading potty-mouth's built-in list never clobbers what someone added.
// Each entry carries { swap, addedBy: 'user' | 'ai', addedAt } — the AI is
// invited (see src/hook.mjs) to add words itself, but every addition is
// tagged and visible via `potty-mouth list`, and removable/resettable by
// the user at any time. The user is always in control of what's here.
export function loadUserWords() {
  try {
    return JSON.parse(fs.readFileSync(tablePath(), 'utf8'));
  } catch {
    return {};
  }
}

export function saveUserWords(userWords) {
  fs.mkdirSync(tableDir(), { recursive: true });
  fs.writeFileSync(tablePath(), JSON.stringify(userWords, null, 2) + '\n', 'utf8');
}

// Merge order: SEED_WORDS < user table on disk. A user override always wins,
// including deleting-by-remapping to a different swap or to REMOVED. Only
// the swap string is exposed here — matchers don't need addedBy/addedAt.
export function loadWords() {
  const userWords = loadUserWords();
  const flatUser = Object.fromEntries(
    Object.entries(userWords).map(([word, meta]) => [word, meta.swap]),
  );
  return { ...SEED_WORDS, ...flatUser };
}

// Guards against turning the table into a footgun: a very short or
// extremely common English word added here would use STRICT (safe,
// double-boundary) matching, so it wouldn't false-positive as a substring —
// but it WOULD then correctly block every literal standalone occurrence of
// an everyday word, which is its own kind of disaster ("the" would block
// nearly every prompt). Length alone isn't a perfect proxy (short ≠ common:
// "yeet" is short and fine, "the" is short and catastrophic), so this pairs
// a length floor with a small curated stopword list. `force: true` lets a
// deliberate override through — the user is always in control, this just
// makes sure it's a deliberate choice, not a typo.
const MIN_WORD_LENGTH = 3;
const COMMON_STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
  'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his',
  'how', 'man', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy',
  'did', 'its', 'let', 'put', 'say', 'she', 'too', 'use', 'this', 'that',
  'with', 'have', 'from', 'they', 'will', 'what', 'when', 'make', 'like',
  'time', 'just', 'know', 'take', 'into', 'your', 'good', 'some', 'could',
  'them', 'than', 'then', 'look', 'only', 'come', 'over', 'also', 'back',
  'after', 'work', 'well', 'even', 'want', 'because', 'these', 'give',
  'most',
]);

export function addWord(word, replacement, addedBy = 'user', { force = false } = {}) {
  const key = word.toLowerCase().trim();
  if (!key) throw new Error('word cannot be empty');
  if (!force && key.length < MIN_WORD_LENGTH) {
    throw new Error(
      `"${key}" is shorter than ${MIN_WORD_LENGTH} characters — too easy to accidentally block ` +
      `common text. Pass force: true (CLI: --force) if you really mean it.`,
    );
  }
  if (!force && COMMON_STOPWORDS.has(key)) {
    throw new Error(
      `"${key}" is a very common English word — blocking it would break normal conversation. ` +
      `Pass force: true (CLI: --force) if you really mean it.`,
    );
  }
  const userWords = loadUserWords();
  userWords[key] = { swap: replacement ?? REMOVED, addedBy, addedAt: new Date().toISOString() };
  saveUserWords(userWords);
  return userWords;
}

export function removeWord(word) {
  const key = word.toLowerCase().trim();
  const userWords = loadUserWords();
  delete userWords[key];
  saveUserWords(userWords);
  return userWords;
}
