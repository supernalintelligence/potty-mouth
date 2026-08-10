import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanFile, cleanPath } from '../src/clean.mjs';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'potty-mouth-clean-test-'));
}

test('cleanFile: plain text, correct swap count, in place', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'notes.txt');
  fs.writeFileSync(file, 'This is a shitty commit message.\nWhat the fuck happened here.\n');

  const result = cleanFile(file);
  assert.equal(result.changed, true);
  assert.equal(result.swaps, 2);
  const content = fs.readFileSync(file, 'utf8');
  assert.equal(content, 'This is a lousy commit message.\nWhat the fox happened here.\n');
});

test('cleanFile: --dry-run reports but never writes', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'notes.txt');
  const original = 'this is a fucking test\n';
  fs.writeFileSync(file, original);

  const result = cleanFile(file, { dryRun: true });
  assert.equal(result.changed, true);
  assert.equal(fs.readFileSync(file, 'utf8'), original, 'dry-run must not modify the file');
});

test('cleanFile: --backup writes a .bak with the original content before modifying', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'notes.txt');
  const original = 'this is a fucking test\n';
  fs.writeFileSync(file, original);

  cleanFile(file, { backup: true });
  assert.equal(fs.readFileSync(file + '.bak', 'utf8'), original);
  assert.notEqual(fs.readFileSync(file, 'utf8'), original);
});

test('cleanFile: a clean file with no matches reports changed:false and is untouched', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'notes.txt');
  const original = 'this is a perfectly clean file about associated skills.\n';
  fs.writeFileSync(file, original);

  const result = cleanFile(file);
  assert.equal(result.changed, false);
  assert.equal(result.swaps, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), original, 'must not rewrite an unchanged file');
});

test('cleanFile: .jsonl walks nested strings inside every parsed line', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(
    file,
    [
      JSON.stringify({ role: 'user', content: 'this is such bullshit and a total fuckup' }),
      JSON.stringify({ role: 'assistant', content: [{ type: 'text', text: 'I understand your frustration.' }] }),
      JSON.stringify({ role: 'user', content: { nested: { deep: 'this is a shitty situation' } } }),
    ].join('\n') + '\n',
  );

  const result = cleanFile(file);
  assert.equal(result.changed, true);
  assert.equal(result.swaps, 3); // bullshit+fuckup=2 on line1, shitty=1 on line3

  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines[0].content, 'this is such nonsense and a total foxup');
  assert.equal(lines[1].content[0].text, 'I understand your frustration.'); // untouched
  assert.equal(lines[2].content.nested.deep, 'this is a lousy situation');
});

test('cleanFile: .jsonl with a malformed line falls back to raw-string cleaning for that line only', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(
    file,
    [
      '{not valid json this is a fucking test',
      JSON.stringify({ role: 'user', content: 'this is fine' }),
    ].join('\n') + '\n',
  );

  const result = cleanFile(file);
  assert.equal(result.changed, true);
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  assert.match(lines[0], /foxing/);
});

test('cleanFile: never applies the fuzzy/prefix-collision bug — only strict swaps run', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'notes.txt');
  const original = 'this should also have a skill associated with it, right?\n';
  fs.writeFileSync(file, original);

  const result = cleanFile(file);
  assert.equal(result.changed, false);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('cleanPath: recursive directory scan, --ext filter respected', () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'this is a fucking test\n');
  fs.writeFileSync(path.join(dir, 'sub', 'b.jsonl'), JSON.stringify({ text: 'this is shit' }) + '\n');
  fs.writeFileSync(path.join(dir, 'c.log'), 'this is a fucking log line\n');

  const allResults = cleanPath(dir);
  assert.equal(allResults.length, 3);
  assert.equal(allResults.filter((r) => r.changed).length, 3);

  const dir2 = tmpDir();
  fs.writeFileSync(path.join(dir2, 'a.txt'), 'this is a fucking test\n');
  fs.writeFileSync(path.join(dir2, 'b.jsonl'), 'this is fine\n');
  const jsonlOnly = cleanPath(dir2, { ext: '.jsonl' });
  assert.equal(jsonlOnly.length, 1);
  assert.ok(jsonlOnly[0].file.endsWith('.jsonl'));
});

test('cleanPath: single-file target works the same as directory mode', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'a.txt');
  fs.writeFileSync(file, 'this is a fucking test\n');
  const results = cleanPath(file);
  assert.equal(results.length, 1);
  assert.equal(results[0].changed, true);
});
