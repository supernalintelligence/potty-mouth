// A persistent, catastrophic-failure disable mechanism — separate from the
// word table and the block counter, and checked BEFORE anything else in
// the hook. Two ways to reach the disabled state:
//
//   1. Manual: `potty-mouth disable` — the user's own explicit choice.
//   2. Automatic: the engine detects an internal contradiction it cannot
//      explain (see engine.mjs's commitBlock — a block decision was about
//      to fire despite the bypass token being present, which should be
//      structurally impossible) and disables itself rather than keep
//      running on logic it can no longer trust.
//
// Either way, once disabled: fully inert, for EVERY installed target at
// once (Claude Code, Codex, Cursor, ...) — this is a global kill switch,
// not per-tool. Every prompt passes through untouched until
// `potty-mouth enable`. Disabling ALSO removes the hook from every
// target's own config (a real uninstall, not just a flag) — belt and
// suspenders, so a stale/cached config file can't keep invoking a process
// that would otherwise just check a flag and no-op.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { uninstallAll } from './installers/index.mjs';

function killSwitchDir() {
  return path.join(os.homedir(), '.potty-mouth');
}

function killSwitchPath() {
  return path.join(killSwitchDir(), 'DISABLED.json');
}

export function isDisabled() {
  return fs.existsSync(killSwitchPath());
}

export function getDisabledInfo() {
  try {
    return JSON.parse(fs.readFileSync(killSwitchPath(), 'utf8'));
  } catch {
    return null;
  }
}

export function disable(reason, { automatic = false, promptExcerpt, sessionId } = {}) {
  fs.mkdirSync(killSwitchDir(), { recursive: true });
  const info = {
    disabledAt: new Date().toISOString(),
    automatic,
    reason,
    ...(promptExcerpt ? { promptExcerpt } : {}),
    ...(sessionId ? { sessionId } : {}),
  };
  fs.writeFileSync(killSwitchPath(), JSON.stringify(info, null, 2) + '\n', 'utf8');
  // Best-effort — an automatic trigger from inside the hook process itself
  // must never let a failure here escape (the hook's own top-level runHook
  // wrapper would swallow it anyway, but be explicit: this is allowed to
  // fail without blocking the fail-open path). uninstallAll() itself never
  // throws (each target's uninstall is individually try/caught), but this
  // stays defensive in case that ever changes.
  try {
    uninstallAll();
  } catch {
    // flag file is already written; that alone is enough to make every
    // target's hook inert on its own next invocation even if a config
    // file edit failed
  }
  return info;
}

export function enable() {
  try {
    fs.unlinkSync(killSwitchPath());
    return true;
  } catch {
    return false;
  }
}
