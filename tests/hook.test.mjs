import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runHook, runCli, freshHome, parseJson } from './helpers.mjs';

test('hook: clean prompt passes through silently, exit 0, no stdout', () => {
  const r = runHook({ prompt: 'please help me refactor this function', session_id: 's1' });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
});

test('hook: profane prompt blocks with a structured decision', () => {
  const r = runHook({ prompt: 'fix this fucking bug', session_id: 's2' });
  assert.equal(r.code, 0); // block is signaled via JSON, not exit code
  const out = parseJson(r.stdout);
  assert.equal(out.decision, 'block');
  assert.equal(typeof out.reason, 'string');
  assert.ok(out.reason.length > 0);
});

test('hook: obfuscated profanity still blocks', () => {
  const r = runHook({ prompt: 'what the actual f*ck is this', session_id: 's3' });
  const out = parseJson(r.stdout);
  assert.equal(out.decision, 'block');
});

test('regression: the exact false-positive prompt from the 2026-08-09 incident passes clean', () => {
  const r = runHook({
    prompt: 'this should also have a skill associated with it that installs the skill and an appropriate install script, right?',
    session_id: 's4',
  });
  assert.equal(r.stdout, '');
});

test('critical: <task-notification> envelope is never scanned, regardless of content', () => {
  const home = freshHome();
  const body = '<task-notification>\n<task-id>abc123</task-id>\n' +
    'this is a fucking huge automated report with real profanity embedded in it, ' +
    'should still never be touched because it is not a human conversation turn. ' +
    '</task-notification>';
  const r = runHook({ prompt: body, session_id: 'notif' }, { home });
  assert.equal(r.stdout, '', 'task-notification envelope must never be blocked or annotated');
  // and it must not have incremented any counter
  const statsOut = runCli(['stats'], { home }).stdout;
  assert.match(statsOut, /Total blocks: 0/);
});

test('critical: <system-reminder> envelope is never scanned', () => {
  const r = runHook({
    prompt: '<system-reminder>internal note: logs mention shit happens sometimes</system-reminder>',
    session_id: 's5',
  });
  assert.equal(r.stdout, '');
});

test('critical: envelope check only applies when the tag is at the START (not a human message that merely mentions the tag name)', () => {
  // A human typing about task-notifications should still be filtered normally.
  const r = runHook({ prompt: 'this fucking task-notification system is confusing', session_id: 's6' });
  const out = parseJson(r.stdout);
  assert.equal(out.decision, 'block');
});

test('critical: prompts over 4000 chars are never scanned (length guard)', () => {
  const long = 'this is a fucking test. '.repeat(200); // > 4000 chars, contains real profanity
  assert.ok(long.length > 4000);
  const r = runHook({ prompt: long, session_id: 's7' });
  assert.equal(r.stdout, '');
});

test('length guard boundary: exactly 4000 chars is still scanned, 4001 is not', () => {
  const home = freshHome();
  // Build precise-length strings ending exactly at the boundary.
  const make = (len) => {
    const filler = 'fuck '.repeat(Math.ceil(len / 5)).slice(0, len);
    return filler;
  };
  const at4000 = make(4000);
  const at4001 = make(4001);
  assert.equal(at4000.length, 4000);
  assert.equal(at4001.length, 4001);

  const r1 = runHook({ prompt: at4000, session_id: 'boundary1' }, { home });
  const out1 = parseJson(r1.stdout);
  assert.equal(out1?.decision, 'block', 'exactly 4000 chars should still be scanned');

  const r2 = runHook({ prompt: at4001, session_id: 'boundary2' }, { home });
  assert.equal(r2.stdout, '', 'over 4000 chars should be skipped entirely');
});

test('bypass token: lets profanity through and reports it via additionalContext', () => {
  const r = runHook({ prompt: 'I_WANT_TO_SWEAR this fucking bug is insane', session_id: 's8' });
  const out = parseJson(r.stdout);
  assert.ok(out?.hookSpecificOutput, 'should emit additionalContext, not a block');
  assert.match(out.hookSpecificOutput.additionalContext, /bypass/i);
  assert.equal(out.decision, undefined, 'must never also be a block decision');
});

test('bypass token: an unrelated clean-looking prompt without the token still gets scanned normally', () => {
  const r = runHook({ prompt: 'fix this fucking bug', session_id: 's9' });
  const out = parseJson(r.stdout);
  assert.equal(out.decision, 'block');
});

test('bypass + pending unnotified blocks are reported together in one context message', () => {
  const home = freshHome();
  runHook({ prompt: 'this is fucking broken', session_id: 'combo' }, { home });
  const r = runHook({ prompt: 'I_WANT_TO_SWEAR now let me swear on purpose', session_id: 'combo' }, { home });
  const out = parseJson(r.stdout);
  assert.match(out.hookSpecificOutput.additionalContext, /bypass/i);
  assert.match(out.hookSpecificOutput.additionalContext, /blocked 1/i);
});

test('context injection: fires once per fresh block, not repeated on subsequent clean turns', () => {
  const home = freshHome();
  runHook({ prompt: 'this is fucking broken', session_id: 'once' }, { home });
  const first = runHook({ prompt: 'please help', session_id: 'once' }, { home });
  const second = runHook({ prompt: 'another clean prompt', session_id: 'once' }, { home });
  assert.ok(parseJson(first.stdout)?.hookSpecificOutput, 'first clean turn after a block should carry context');
  assert.equal(second.stdout, '', 'second clean turn should be silent — already notified');
});

test('milestone: the 42nd block in a session gets the dedicated Hitchhiker easter egg', () => {
  const home = freshHome();
  let last;
  for (let i = 0; i < 42; i++) {
    last = runHook({ prompt: 'this is fucking broken again', session_id: 'milestone' }, { home });
  }
  const out = parseJson(last.stdout);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /forty-two/i);
});

test('session isolation: two different session_ids maintain independent block counts', () => {
  const home = freshHome();
  runHook({ prompt: 'this is fucking broken', session_id: 'session-a' }, { home });
  runHook({ prompt: 'this is fucking broken', session_id: 'session-a' }, { home });
  runHook({ prompt: 'this is fucking broken', session_id: 'session-b' }, { home });

  const statsOut = runCli(['stats'], { home }).stdout;
  assert.match(statsOut, /Total blocks: 3/);
});

test('state persists across separate hook process invocations within the same HOME', () => {
  const home = freshHome();
  runHook({ prompt: 'this is fucking broken', session_id: 'persist' }, { home });
  const statsOut = runCli(['stats'], { home }).stdout;
  assert.match(statsOut, /Total blocks: 1/);
});

test('malformed JSON on stdin fails open (never blocks, never crashes)', () => {
  const r = runCli(['hook'], { input: 'not valid json {{{' });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
});

test('missing prompt field entirely is treated as empty text, passes through', () => {
  const r = runHook({ session_id: 'no-prompt-field' });
  assert.equal(r.stdout, '');
});

test('legacy user_input field name is also accepted (API drift tolerance)', () => {
  const r = runHook({ user_input: 'fix this fucking bug', session_id: 'legacy' });
  const out = parseJson(r.stdout);
  assert.equal(out.decision, 'block');
});

test('empty session_id (undefined) does not crash and is tracked under a fallback key', () => {
  const home = freshHome();
  const r = runHook({ prompt: 'this is fucking broken' }, { home });
  assert.equal(parseJson(r.stdout)?.decision, 'block');
  const statsOut = runCli(['stats'], { home }).stdout;
  assert.match(statsOut, /Total blocks: 1/);
});

test('critical: an unexpected internal error (not just malformed JSON) still fails open, never crashes uncaught', () => {
  // Force fs.mkdirSync(~/.potty-mouth) to throw by putting a FILE where the
  // directory needs to go — simulates a permission error or any other
  // unanticipated runtime failure. The hook must still exit cleanly with
  // no output rather than crash uncaught (undefined behavior from Claude
  // Code's side) over its own internal bug.
  const home = freshHome();
  fs.writeFileSync(path.join(home, '.potty-mouth'), 'not a directory');

  const r = runHook({ prompt: 'this is fucking broken', session_id: 'boom' }, { home });
  assert.equal(r.code, 0, 'must exit 0 even when internal state writes fail');
  assert.equal(r.stdout, '', 'must never emit a block decision built on a half-failed write');
});
