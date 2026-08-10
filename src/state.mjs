// Block/bypass counters — total (all-time) and per Claude Code session, plus
// a "what hasn't Claude been told yet" cursor so the hook can inform the
// model once per new block instead of nagging every turn. User-owned,
// user-resettable; the AI never touches this file directly.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const MAX_SESSIONS = 100;

function stateDir() {
  return path.join(os.homedir(), '.potty-mouth');
}

function statePath() {
  return path.join(stateDir(), 'state.json');
}

function lockPath() {
  return path.join(stateDir(), '.lock');
}

function defaultState() {
  return { totalBlocks: 0, totalBypasses: 0, sessions: {} };
}

// Synchronous sleep via Atomics.wait — no external dependency, works because
// hooks are short-lived one-shot processes where blocking briefly is fine
// (the alternative, going async, would ripple through every caller for a
// lock that's held for single-digit milliseconds in practice).
function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// mkdir is atomic on every platform Node supports, so this is a real lock,
// not a check-then-act race. Bounded retry with backoff; a lock older than
// STALE_MS is assumed abandoned by a crashed process and stolen — never
// wait forever, since this runs inside a hook that must not hang a real
// conversation turn over its own bookkeeping.
const STALE_MS = 2000;
const MAX_WAIT_MS = 300;

function acquireLock() {
  fs.mkdirSync(stateDir(), { recursive: true });
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    try {
      fs.mkdirSync(lockPath());
      return true;
    } catch {
      try {
        const age = Date.now() - fs.statSync(lockPath()).mtimeMs;
        if (age > STALE_MS) {
          fs.rmdirSync(lockPath());
          continue; // retry immediately, no sleep
        }
      } catch {
        // lock disappeared between the failed mkdir and this stat -> retry
        continue;
      }
      sleepMs(10);
    }
  }
  return false;
}

function releaseLock() {
  try {
    fs.rmdirSync(lockPath());
  } catch {
    // already gone (stolen as stale, or never actually acquired) -> fine
  }
}

// Runs fn() with the state file locked against other potty-mouth processes,
// so a concurrent block/bypass from a different session can't be lost to a
// read-modify-write race. If the lock can't be acquired within the budget
// (another process is wedged, or the lock dir itself can't be created),
// proceeds WITHOUT it rather than hanging — losing one counter update is
// far better than blocking a real conversation turn.
function withLock(fn) {
  const locked = acquireLock();
  try {
    return fn();
  } finally {
    if (locked) releaseLock();
  }
}

export function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    return {
      totalBlocks: raw.totalBlocks ?? 0,
      totalBypasses: raw.totalBypasses ?? 0,
      sessions: raw.sessions ?? {},
    };
  } catch {
    return defaultState();
  }
}

function saveState(state) {
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2) + '\n', 'utf8');
}

// Drop the oldest sessions beyond MAX_SESSIONS (by last activity, whether
// that activity was a block or a bypass) so this file never grows unbounded
// over a machine's lifetime of Claude Code use.
function pruneSessions(sessions) {
  const entries = Object.entries(sessions);
  if (entries.length <= MAX_SESSIONS) return sessions;
  entries.sort((a, b) => new Date(a[1].lastActivityAt) - new Date(b[1].lastActivityAt));
  return Object.fromEntries(entries.slice(entries.length - MAX_SESSIONS));
}

function getSession(state, sessionId) {
  const key = sessionId || 'unknown';
  return state.sessions[key] ?? { blocks: 0, bypasses: 0, lastNotifiedCount: 0 };
}

export function recordBlock(sessionId) {
  return withLock(() => {
    const state = loadState();
    state.totalBlocks += 1;
    const key = sessionId || 'unknown';
    const session = getSession(state, sessionId);
    session.blocks += 1;
    session.lastActivityAt = new Date().toISOString();
    state.sessions[key] = session;
    state.sessions = pruneSessions(state.sessions);
    saveState(state);
    return { totalBlocks: state.totalBlocks, sessionBlocks: session.blocks };
  });
}

export function recordBypass(sessionId) {
  return withLock(() => {
    const state = loadState();
    state.totalBypasses += 1;
    const key = sessionId || 'unknown';
    const session = getSession(state, sessionId);
    session.bypasses += 1;
    session.lastActivityAt = new Date().toISOString();
    state.sessions[key] = session;
    state.sessions = pruneSessions(state.sessions);
    saveState(state);
    return { totalBypasses: state.totalBypasses, sessionBypasses: session.bypasses };
  });
}

// Returns { delta, sessionBlocks, totalBlocks } if this session has had
// block(s) since the last time we told Claude about it, else null. Marks
// them notified as a side effect, so each fresh block gets mentioned once.
export function takeUnnotified(sessionId) {
  return withLock(() => {
    const state = loadState();
    const key = sessionId || 'unknown';
    const session = state.sessions[key];
    if (!session) return null;
    const prevNotified = session.lastNotifiedCount ?? 0;
    if (session.blocks <= prevNotified) return null;
    const delta = session.blocks - prevNotified;
    session.lastNotifiedCount = session.blocks;
    state.sessions[key] = session;
    saveState(state);
    return { delta, sessionBlocks: session.blocks, totalBlocks: state.totalBlocks };
  });
}

export function getStats() {
  return loadState();
}

// The only thing this ever resets is the counters — word table additions
// are a separate concern (`potty-mouth remove`/`add`), so a user resetting
// the count never loses table edits, and the two "always in control"
// actions stay independently reversible.
export function resetStats() {
  return withLock(() => {
    const before = loadState();
    saveState(defaultState());
    return before;
  });
}
