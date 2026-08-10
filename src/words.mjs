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

// Merge order: SEED_WORDS < user table on disk. A user override always wins,
// including deleting-by-remapping to a different swap or to REMOVED.
export function loadWords() {
  const file = tablePath();
  let userWords = {};
  try {
    userWords = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // no user table yet, or unreadable -> seed only
  }
  return { ...SEED_WORDS, ...userWords };
}

// Only ever writes the USER's additions/overrides, never the seed table, so
// upgrading potty-mouth's built-in list never clobbers what someone added.
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

export function addWord(word, replacement) {
  const key = word.toLowerCase().trim();
  if (!key) throw new Error('word cannot be empty');
  const userWords = loadUserWords();
  userWords[key] = replacement ?? REMOVED;
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
