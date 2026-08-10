// Shared test helpers. CLI/hook tests run the REAL bin script as a genuine
// subprocess with an isolated $HOME per test — this is deliberate, not
// laziness: it's the only way to test what actually ships (the exact
// process Claude Code spawns), and it can never leak state between tests
// or touch the real ~/.potty-mouth / ~/.claude on this machine.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const BIN = path.join(__dirname, '..', 'bin', 'potty-mouth.mjs');

export function freshHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'potty-mouth-test-'));
}

// Runs `node bin/potty-mouth.mjs <args>` as a real child process.
// Never throws on non-zero exit — callers assert on `code` explicitly.
export function runCli(args, { home, input } = {}) {
  try {
    const stdout = execFileSync('node', [BIN, ...args], {
      input: input ?? '',
      env: { ...process.env, HOME: home ?? freshHome() },
      encoding: 'utf8',
    });
    return { stdout, stderr: '', code: 0 };
  } catch (err) {
    return { stdout: err.stdout ?? '', stderr: err.stderr ?? '', code: err.status ?? 1 };
  }
}

// Runs the hook exactly the way Claude Code does: JSON on stdin, JSON (or
// nothing) on stdout.
export function runHook(payload, { home } = {}) {
  return runCli(['hook'], { home, input: JSON.stringify(payload) });
}

export function parseJson(stdout) {
  if (!stdout.trim()) return null;
  return JSON.parse(stdout);
}
