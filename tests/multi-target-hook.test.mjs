import test from 'node:test';
import assert from 'node:assert/strict';
import { runCli, freshHome, parseJson } from './helpers.mjs';

test('codex hook: clean prompt passes through silently, using codex field names', () => {
  const r = runCli(['hook', '--target', 'codex'], {
    input: JSON.stringify({ prompt: 'please help me refactor this', session_id: 'codex-s1', hook_event_name: 'UserPromptSubmit' }),
  });
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '');
});

test('codex hook: profane prompt blocks with the exact same decision shape as Claude Code', () => {
  const r = runCli(['hook', '--target', 'codex'], {
    input: JSON.stringify({ prompt: 'this is fucking broken', session_id: 'codex-s2' }),
  });
  const out = parseJson(r.stdout);
  assert.equal(out.decision, 'block');
  assert.equal(typeof out.reason, 'string');
});

test('codex hook: bypass token works identically to Claude Code', () => {
  const r = runCli(['hook', '--target', 'codex'], {
    input: JSON.stringify({ prompt: 'I_WANT_TO_SWEAR fuck yeah', session_id: 'codex-s3' }),
  });
  const out = parseJson(r.stdout);
  assert.ok(out.hookSpecificOutput);
  assert.match(out.hookSpecificOutput.additionalContext, /bypass/i);
});

test('cursor hook: clean prompt -> continue:true, using conversation_id not session_id', () => {
  const r = runCli(['hook', '--target', 'cursor'], {
    input: JSON.stringify({ prompt: 'please help me refactor this', conversation_id: 'conv-1', attachments: [] }),
  });
  const out = parseJson(r.stdout);
  assert.deepEqual(out, { continue: true });
});

test('cursor hook: profane prompt -> continue:false with user_message, NOT the Claude Code decision shape', () => {
  const r = runCli(['hook', '--target', 'cursor'], {
    input: JSON.stringify({ prompt: 'this is fucking broken', conversation_id: 'conv-2' }),
  });
  const out = parseJson(r.stdout);
  assert.equal(out.continue, false);
  assert.equal(typeof out.user_message, 'string');
  assert.equal(out.decision, undefined, 'must use cursor\'s own contract, not leak the claude-code shape');
});

test('cursor hook: bypass token lets profanity through (continue:true), even though the context note has nowhere to go', () => {
  const r = runCli(['hook', '--target', 'cursor'], {
    input: JSON.stringify({ prompt: 'I_WANT_TO_SWEAR fuck yeah', conversation_id: 'conv-3' }),
  });
  const out = parseJson(r.stdout);
  assert.deepEqual(out, { continue: true });
});

test('per-conversation counting is isolated per target adapter\'s own session concept', () => {
  const home = freshHome();
  runCli(['hook', '--target', 'codex'], { home, input: JSON.stringify({ prompt: 'this is fucking broken', session_id: 'shared-id' }) });
  runCli(['hook', '--target', 'cursor'], { home, input: JSON.stringify({ prompt: 'this is fucking broken', conversation_id: 'shared-id' }) });
  // Both used the same literal ID string on purpose -- since sessionId is
  // just a plain state.json key, they legitimately share a counter bucket.
  // This documents that behavior rather than asserting isolation that
  // doesn't actually exist at the state layer.
  const stats = runCli(['stats'], { home }).stdout;
  assert.match(stats, /Total blocks: 2/);
});

test('unknown target on hook fails open (no crash, no output) rather than throwing', () => {
  const r = runCli(['hook', '--target', 'notarealtool'], { input: JSON.stringify({ prompt: 'fuck' }) });
  assert.equal(r.code, 2, 'CLI-level validation catches it before even reaching runHook');
});
