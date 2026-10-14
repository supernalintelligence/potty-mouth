import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { detect, cleanText } from '../src/match.mjs';
import { SEED_WORDS, SEED_FUZZY_ROOTS, REMOVED } from '../src/words.mjs';

test('cleanText: exact word swap, case preserved', () => {
  const r = cleanText('This is FUCKING bad, fuck.', SEED_WORDS, REMOVED);
  assert.equal(r.changed, true);
  assert.equal(r.swaps, 2);
  assert.equal(r.text, 'This is FOXING bad, fox.');
});

test('cleanText: slurs resolve to REMOVED, never a swap', () => {
  const r = cleanText('do not say slut', SEED_WORDS, REMOVED);
  assert.equal(r.text, 'do not say [removed]');
});

test('cleanText: never touches a table word appearing as a substring of an innocent word', () => {
  const innocent = [
    'class', 'associated', 'assume', 'assist', 'assess', 'association',
    'assassinate', 'asset', 'assign', 'hello', 'hells bells', 'shell',
    'cockpit', 'cocktail', 'cockroach', 'cocky', 'dickens', 'prickly',
    'prickle', 'grasshopper', 'passbook', 'compass', 'bass guitar',
  ];
  for (const s of innocent) {
    const r = cleanText(s, SEED_WORDS, REMOVED);
    assert.equal(r.changed, false, `should not touch "${s}"`);
  }
});

test('cleanText: punctuation-adjacent words still match (real word boundary, not just whitespace)', () => {
  for (const [input, expected] of [
    ['fuck!', 'fox!'],
    ['(ass)', '(butt)'],
    ['ass,', 'butt,'],
    ['fuck.', 'fox.'],
    ['"shit"', '"junk"'],
  ]) {
    const r = cleanText(input, SEED_WORDS, REMOVED);
    assert.equal(r.text, expected, `"${input}" -> expected "${expected}", got "${r.text}"`);
  }
});

test('detect: plain instances of every fuzzy root are caught (sanity floor)', () => {
  for (const root of SEED_FUZZY_ROOTS) {
    assert.equal(detect(root, SEED_WORDS, SEED_FUZZY_ROOTS), true, `should detect plain "${root}"`);
  }
});

test('detect: obfuscated forms of curated roots are caught', () => {
  const cases = ['f*ck', 'sh!t', 'f.u.c.k', 'a$$hole', 'b1tch', 'sh1t', 'FUCK', 'F*CK', 'f u c k'];
  for (const c of cases) {
    assert.equal(detect(c, SEED_WORDS, SEED_FUZZY_ROOTS), true, `should detect "${c}"`);
  }
});

test('detect: obfuscated root + legitimate conjugation suffix still caught', () => {
  assert.equal(detect('this is f*cking annoying', SEED_WORDS, SEED_FUZZY_ROOTS), true);
  assert.equal(detect('sh1tty code', SEED_WORDS, SEED_FUZZY_ROOTS), true);
});

test('regression 2026-08-09: fuzzy detector no longer flags common words via prefix collision', () => {
  // "ass" false-positived "associated" (missing end boundary); cock/dick/
  // prick false-positived cockpit/cocktail/dickens/prickly (removed from
  // the curated root list). Both classes must stay fixed.
  const innocent = [
    'associated', 'assume', 'assist', 'association', 'hello', 'shell',
    'cockpit', 'cocktail', 'cockroach', 'cocky', 'dickens', 'prickly', 'prickle',
  ];
  for (const w of innocent) {
    assert.equal(detect(w, SEED_WORDS, SEED_FUZZY_ROOTS), false, `should not flag "${w}"`);
  }
});

test('regression 2026-08-20: numbered list items no longer false-positive via mask+whitespace collision', () => {
  // "5. it should yes" read as leet '5'->s, mask "."->stand-in for 'h', a
  // normal separator " ", then "it" -> i+t: an accidental obfuscated match
  // for the "shit" fuzzy root. Any numbered-list sentence shaped like
  // "<digit>. <word starting with a letter that continues the root>" was at
  // risk the same way.
  const innocent = [
    '5. it should yes', '5. it should yes.', 'talk about it 5. it works',
  ];
  for (const s of innocent) {
    assert.equal(detect(s, SEED_WORDS, SEED_FUZZY_ROOTS), false, `should not flag "${s}"`);
  }
});

test('regression 2026-08-23: closing-delimiter + space no longer bridges two real words', () => {
  // "DB(s) hit the..." read as: 's' (literal, end of "(s)"), SEP -> ") "
  // (closing paren + space), then "hit" -> h+i+t: an accidental obfuscated
  // match for the "shit" fuzzy root, spanning the end of one real word and
  // the start of a completely unrelated next word. Same bug class as the
  // 2026-08-20 regression above, via the plain-letter SEP path instead of
  // the mask-substitution TIGHT_SEP path.
  const innocent = [
    'DB(s) hit the registry',
    'board DB(s) hit the structural registry fallback',
    'the list(s) it references',
    'file(s) it touched',
  ];
  for (const s of innocent) {
    assert.equal(detect(s, SEED_WORDS, SEED_FUZZY_ROOTS), false, `should not flag "${s}"`);
  }
});

test('regression 2026-10-13: file extension + space no longer reads as spaced-out evasion', () => {
  // "runme.sh it should work" read as "sh it" -> the "shit" fuzzy root: the
  // '.' before "sh" counted as a word boundary, and SEP allows a space
  // between letters ("s h i t"). A '.', '/', '\' or '-' before the match is a
  // file extension, a path or a flag, never the start of an obfuscated word.
  const innocent = [
    "why don't you just do runme.sh it should work",
    'run BUILDME.sh it should finish',
    'call scripts/dev.sh it works',
    'use install.sh it needs root',
    'bash -sh it',
  ];
  for (const s of innocent) {
    assert.equal(detect(s, SEED_WORDS, SEED_FUZZY_ROOTS), false, `should not flag "${s}"`);
  }
  // Real obfuscation at the start of a word is still caught.
  for (const s of ['what a sh it', 'this is sh!t', 'that s h i t again', 'f u c k this']) {
    assert.equal(detect(s, SEED_WORDS, SEED_FUZZY_ROOTS), true, `should flag "${s}"`);
  }
});

test('regression 2026-10-13b: obfuscation prefixed by punctuation is still caught', () => {
  // The first version of the file-extension fix put a lookbehind on the whole fuzzy matcher, which
  // also hid obfuscated words that follow '.', '/', '-' or a word char ("ok.f*ck it", "no-sh!t").
  // Only a match that spans whitespace is ignored after those characters.
  const bad = [
    'ok.f*ck it', 'yeah.sh1t', 'no-sh!t', 'and/f*ck', '--f*ck', 'what.f.u.c.k', 'this is bad.sh!t here',
  ];
  for (const s of bad) {
    assert.equal(detect(s, SEED_WORDS, SEED_FUZZY_ROOTS), true, `should flag "${s}"`);
  }
});

test('detect: a root that is ALSO a common-word prefix is still caught as a bare/plain word via strict', () => {
  // cock/dick/prick were removed from FUZZY roots but remain in the STRICT
  // full table, so a plain (non-obfuscated) standalone use is still caught.
  assert.equal(detect('he is such a dick', SEED_WORDS, SEED_FUZZY_ROOTS), true);
  assert.equal(detect('what a prick', SEED_WORDS, SEED_FUZZY_ROOTS), true);
});

test('detect: emoji/unicode adjacency does not crash and still detects', () => {
  assert.doesNotThrow(() => detect('😡fuck😡', SEED_WORDS, SEED_FUZZY_ROOTS));
  assert.equal(detect('😡fuck😡', SEED_WORDS, SEED_FUZZY_ROOTS), true);
  assert.doesNotThrow(() => detect('héllo wörld ünïcode', SEED_WORDS, SEED_FUZZY_ROOTS));
  assert.equal(detect('héllo wörld', SEED_WORDS, SEED_FUZZY_ROOTS), false);
});

test('detect: empty / non-string / null / undefined input is safe, never throws', () => {
  for (const v of ['', null, undefined, 42, {}, []]) {
    assert.doesNotThrow(() => detect(v, SEED_WORDS, SEED_FUZZY_ROOTS));
    assert.equal(detect(v, SEED_WORDS, SEED_FUZZY_ROOTS), false);
  }
});

test('detect: no fuzzy roots passed -> strict-only, still works', () => {
  assert.equal(detect('fuck', SEED_WORDS, []), true);
  assert.equal(detect('fuck', SEED_WORDS), true); // default param
});

test('SEED_WORDS source literal has no accidental duplicate keys', () => {
  const wordsPath = fileURLToPath(new URL('../src/words.mjs', import.meta.url));
  const src = fs.readFileSync(wordsPath, 'utf8');
  const start = src.indexOf('export const SEED_WORDS = {');
  const end = src.indexOf('\n};', start);
  assert.ok(start !== -1 && end !== -1, 'could not locate SEED_WORDS block for static check');
  const body = src.slice(start, end);
  const keys = [...body.matchAll(/(?:^|[\s{,])([a-zA-Z_][a-zA-Z0-9_]*):\s*/gm)].map((m) => m[1]);
  const counts = new Map();
  for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  const dupes = [...counts.entries()].filter(([, c]) => c > 1).map(([k]) => k);
  assert.deepEqual(dupes, [], `duplicate keys silently overwritten: ${dupes.join(', ')}`);
});

test('SEED_FUZZY_ROOTS is a subset of SEED_WORDS keys (every fuzzy root has a real table entry)', () => {
  for (const root of SEED_FUZZY_ROOTS) {
    assert.ok(root in SEED_WORDS, `fuzzy root "${root}" has no matching SEED_WORDS entry`);
  }
});
