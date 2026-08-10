import test from 'node:test';
import assert from 'node:assert/strict';
import { getAdapter, ADAPTERS } from '../src/adapters/index.mjs';
import * as claudeCode from '../src/adapters/claude-code.mjs';
import * as codex from '../src/adapters/codex.mjs';
import * as cursor from '../src/adapters/cursor.mjs';

test('getAdapter: defaults to claude-code, throws on unknown target', () => {
  assert.equal(getAdapter(undefined), ADAPTERS['claude-code']);
  assert.equal(getAdapter('claude-code'), ADAPTERS['claude-code']);
  assert.throws(() => getAdapter('notarealtool'), /Unknown target/);
});

test('claude-code adapter: parses prompt/user_input/session_id, serializes block and context', () => {
  assert.deepEqual(
    claudeCode.parseInput(JSON.stringify({ prompt: 'hello', session_id: 's1' })),
    { promptText: 'hello', sessionId: 's1' },
  );
  assert.deepEqual(
    claudeCode.parseInput(JSON.stringify({ user_input: 'legacy field', session_id: 's2' })),
    { promptText: 'legacy field', sessionId: 's2' },
  );

  const blockOut = JSON.parse(claudeCode.serializeDecision({ action: 'block', reason: 'nope' }));
  assert.equal(blockOut.decision, 'block');
  assert.equal(blockOut.reason, 'nope');

  const contextOut = JSON.parse(claudeCode.serializeDecision({ action: 'allow', context: 'fyi' }));
  assert.equal(contextOut.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.equal(contextOut.hookSpecificOutput.additionalContext, 'fyi');

  assert.equal(claudeCode.serializeDecision({ action: 'allow' }), '');
});

test('codex adapter is the exact same functions as claude-code (verified byte-identical contract)', () => {
  assert.equal(codex.parseInput, claudeCode.parseInput);
  assert.equal(codex.serializeDecision, claudeCode.serializeDecision);
});

test('cursor adapter: parses prompt/conversation_id (no session_id field)', () => {
  assert.deepEqual(
    cursor.parseInput(JSON.stringify({
      prompt: 'hello',
      conversation_id: 'conv-1',
      attachments: [],
      model: 'gpt-x',
    })),
    { promptText: 'hello', sessionId: 'conv-1' },
  );
});

test('cursor adapter: block serializes to continue:false + user_message', () => {
  const out = JSON.parse(cursor.serializeDecision({ action: 'block', reason: 'nope' }));
  assert.equal(out.continue, false);
  assert.equal(out.user_message, 'nope');
});

test('cursor adapter: allow always serializes to continue:true, context silently dropped (no documented channel for it)', () => {
  const plain = JSON.parse(cursor.serializeDecision({ action: 'allow' }));
  assert.deepEqual(plain, { continue: true });

  const withContext = JSON.parse(cursor.serializeDecision({ action: 'allow', context: 'some note' }));
  assert.deepEqual(withContext, { continue: true }); // context has nowhere to go on this target
});

test('all three adapters expose the same parseInput/serializeDecision function signature shape', () => {
  for (const [name, adapter] of Object.entries(ADAPTERS)) {
    assert.equal(typeof adapter.parseInput, 'function', `${name} missing parseInput`);
    assert.equal(typeof adapter.serializeDecision, 'function', `${name} missing serializeDecision`);
  }
});
