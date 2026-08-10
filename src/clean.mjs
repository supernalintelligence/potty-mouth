// "Clean it up afterward" — scans a file or directory and applies the same
// deterministic word-table swap the hook uses to block, but as an in-place
// rewrite instead of a refusal. No LLM stage, no obfuscation-guessing
// rewrite — strict word-boundary swaps only, so it never mangles text it
// wasn't sure about. Handles plain text and .jsonl (walks nested strings in
// each parsed line, same shape as a Claude Code transcript file).
import fs from 'node:fs';
import path from 'node:path';
import { loadWords, REMOVED } from './words.mjs';
import { cleanText } from './match.mjs';

function walkValue(val, words) {
  if (typeof val === 'string') {
    const { changed, swaps, text } = cleanText(val, words, REMOVED);
    return { changed, swaps, value: changed ? text : val };
  }
  if (Array.isArray(val)) {
    let anyChanged = false;
    let swaps = 0;
    const next = val.map((item) => {
      const r = walkValue(item, words);
      if (r.changed) anyChanged = true;
      swaps += r.swaps;
      return r.value;
    });
    return { changed: anyChanged, swaps, value: anyChanged ? next : val };
  }
  if (val !== null && typeof val === 'object') {
    let anyChanged = false;
    let swaps = 0;
    const next = {};
    for (const key of Object.keys(val)) {
      const r = walkValue(val[key], words);
      if (r.changed) anyChanged = true;
      swaps += r.swaps;
      next[key] = r.value;
    }
    return { changed: anyChanged, swaps, value: anyChanged ? next : val };
  }
  return { changed: false, swaps: 0, value: val };
}

function cleanJsonlContent(content, words) {
  const lines = content.split('\n');
  let fileChanged = false;
  let swaps = 0;
  const newLines = lines.map((line) => {
    if (!line.trim()) return line;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      const r = cleanText(line, words, REMOVED);
      if (r.changed) { fileChanged = true; swaps += r.swaps; return r.text; }
      return line;
    }
    const r = walkValue(parsed, words);
    if (r.changed) { fileChanged = true; swaps += r.swaps; return JSON.stringify(r.value); }
    return line;
  });
  return { changed: fileChanged, swaps, content: newLines.join('\n') };
}

function cleanPlainContent(content, words) {
  const { changed, swaps, text } = cleanText(content, words, REMOVED);
  return { changed, swaps, content: text };
}

export function cleanFile(filePath, opts = {}) {
  const words = loadWords();
  const content = fs.readFileSync(filePath, 'utf8');
  const isJsonl = filePath.endsWith('.jsonl');
  const result = isJsonl ? cleanJsonlContent(content, words) : cleanPlainContent(content, words);

  if (result.changed && !opts.dryRun) {
    if (opts.backup) fs.copyFileSync(filePath, filePath + '.bak');
    fs.writeFileSync(filePath, result.content, 'utf8');
  }

  return { file: filePath, changed: result.changed, swaps: result.swaps };
}

function collectFiles(target, extFilter) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];
  const results = [];
  for (const entry of fs.readdirSync(target)) {
    const full = path.join(target, entry);
    let entryStat;
    try {
      entryStat = fs.statSync(full);
    } catch {
      continue;
    }
    if (entryStat.isDirectory()) results.push(...collectFiles(full, extFilter));
    else if (!extFilter || full.endsWith(extFilter)) results.push(full);
  }
  return results;
}

export function cleanPath(target, opts = {}) {
  const files = collectFiles(target, opts.ext);
  return files.map((f) => cleanFile(f, opts));
}
