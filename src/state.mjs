// Block counter — total (all-time) and per Claude Code session, plus a
// "what hasn't Claude been told yet" cursor so the hook can inform the
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

function defaultState() {
  return { totalBlocks: 0, sessions: {} };
}

export function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    return { totalBlocks: raw.totalBlocks ?? 0, sessions: raw.sessions ?? {} };
  } catch {
    return defaultState();
  }
}

function saveState(state) {
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2) + '\n', 'utf8');
}

// Drop the oldest sessions beyond MAX_SESSIONS (by last activity) so this
// file never grows unbounded over a machine's lifetime of Claude Code use.
function pruneSessions(sessions) {
  const entries = Object.entries(sessions);
  if (entries.length <= MAX_SESSIONS) return sessions;
  entries.sort((a, b) => new Date(a[1].lastBlockedAt) - new Date(b[1].lastBlockedAt));
  return Object.fromEntries(entries.slice(entries.length - MAX_SESSIONS));
}

export function recordBlock(sessionId) {
  const state = loadState();
  state.totalBlocks += 1;
  const key = sessionId || 'unknown';
  const session = state.sessions[key] ?? { blocks: 0, lastNotifiedCount: 0 };
  session.blocks += 1;
  session.lastBlockedAt = new Date().toISOString();
  state.sessions[key] = session;
  state.sessions = pruneSessions(state.sessions);
  saveState(state);
  return { totalBlocks: state.totalBlocks, sessionBlocks: session.blocks };
}

// Returns { delta, sessionBlocks, totalBlocks } if this session has had
// block(s) since the last time we told Claude about it, else null. Marks
// them notified as a side effect, so each fresh block gets mentioned once.
export function takeUnnotified(sessionId) {
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
}

export function getStats() {
  return loadState();
}

// The only thing this ever resets is the counter — word table additions are
// a separate concern (`potty-mouth remove`/`add`), so a user resetting the
// count never loses table edits, and the two "always in control" actions
// stay independently reversible.
export function resetStats() {
  const before = loadState();
  saveState(defaultState());
  return before;
}
