import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runCli, runHook, freshHome, parseJson } from './helpers.mjs';
import { commitBlock } from '../src/engine.mjs';

test('status: reports enabled when never disabled', () => {
  const home = freshHome();
  const out = runCli(['status'], { home }).stdout;
  assert.match(out, /^Enabled/);
});

test('disable: manual — writes the flag, uninstalls from settings.json, table/counters untouched', () => {
  const home = freshHome();
  runCli(['install'], { home });
  runCli(['add', 'yeet', 'toss'], { home });
  runHook({ prompt: 'this is fucking broken', session_id: 's1' }, { home });

  const r = runCli(['disable', 'testing the kill switch'], { home });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Disabled/);

  const status = runCli(['status'], { home }).stdout;
  assert.match(status, /DISABLED \(manual\)/);
  assert.match(status, /testing the kill switch/);

  const settings = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
  const commands = settings.hooks.UserPromptSubmit.flatMap((g) => g.hooks).map((h) => h.command);
  assert.ok(!commands.some((c) => c.includes('potty-mouth hook')), 'disable must uninstall from settings.json');

  const list = runCli(['list'], { home }).stdout;
  assert.match(list, /yeet -> toss/, 'word table must survive disable');
  const stats = runCli(['stats'], { home }).stdout;
  assert.match(stats, /Total blocks: 1/, 'counters must survive disable');
});

test('hook: fully inert while disabled — even blatant profanity passes through silently, no counting', () => {
  const home = freshHome();
  runCli(['disable', 'test'], { home });

  const r = runHook({ prompt: 'this is fucking absolutely disgustingly filthy shit', session_id: 's1' }, { home });
  assert.equal(r.stdout, '', 'disabled hook must never block or annotate');

  const stats = runCli(['stats'], { home }).stdout;
  assert.match(stats, /Total blocks: 0/, 'disabled hook must not increment counters');
});

test('enable: clears the flag, but does not silently reinstall', () => {
  const home = freshHome();
  runCli(['install'], { home });
  runCli(['disable', 'test'], { home });

  const r = runCli(['enable'], { home });
  assert.match(r.stdout, /Re-enabled/);
  assert.match(r.stdout, /potty-mouth install \[--target/);

  const status = runCli(['status'], { home }).stdout;
  assert.match(status, /^Enabled/);

  // settings.json entry must still be absent — enable() only clears the flag
  const settingsPath = path.join(home, '.claude', 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const commands = settings.hooks.UserPromptSubmit.flatMap((g) => g.hooks).map((h) => h.command);
  assert.ok(!commands.some((c) => c.includes('potty-mouth hook')), 'enable must not auto-reinstall');
});

test('enable: no-op when not disabled', () => {
  const home = freshHome();
  const r = runCli(['enable'], { home });
  assert.match(r.stdout, /Was not disabled/);
});

test('critical: commitBlock refuses to block when the bypass token is present, no matter who calls it', () => {
  // This exercises the defense-in-depth gateway DIRECTLY, independent of
  // the normal engine.decide() control flow that would never call
  // commitBlock with a bypass-containing prompt in the first place —
  // simulating exactly the "some future bug calls this the wrong way"
  // scenario the gateway exists to catch. commitBlock returns a plain
  // Decision object (adapter-agnostic), no stdout capture needed.
  const home = freshHome();
  const originalHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const decision = commitBlock('I_WANT_TO_SWEAR fuck this test', 'contradiction-session');

    assert.notEqual(decision.action, 'block', 'must never emit a block decision in this contradiction');
    assert.equal(decision.action, 'allow');
    assert.ok(decision.context, 'must emit an explanatory context instead');
    assert.match(decision.context, /disabled itself/i);
    assert.match(decision.context, /bug report/i);

    const disabledPath = path.join(home, '.potty-mouth', 'DISABLED.json');
    assert.ok(fs.existsSync(disabledPath), 'must persist the disabled flag');
    const info = JSON.parse(fs.readFileSync(disabledPath, 'utf8'));
    assert.equal(info.automatic, true);
    assert.match(info.reason, /structurally impossible/i);
    assert.match(info.promptExcerpt, /fuck this test/);
    assert.equal(info.sessionId, 'contradiction-session');
  } finally {
    process.env.HOME = originalHome;
  }
});

test('critical: after an automatic trigger, the hook is inert on its very next real invocation', () => {
  const home = freshHome();
  const originalHome = process.env.HOME;
  process.env.HOME = home;
  try {
    commitBlock('I_WANT_TO_SWEAR trigger it', 'auto-session');
  } finally {
    process.env.HOME = originalHome;
  }

  // Now drive it through the REAL subprocess hook, same HOME, and confirm
  // it's inert even for a completely unrelated profane prompt.
  const r = runHook({ prompt: 'this is fucking broken', session_id: 'after-trigger' }, { home });
  assert.equal(r.stdout, '');
  const status = runCli(['status'], { home }).stdout;
  assert.match(status, /DISABLED \(automatic/);
});

test('critical: an automatic kill-switch trigger uninstalls from EVERY target, not just the one active', () => {
  const home = freshHome();
  const originalHome = process.env.HOME;
  process.env.HOME = home;
  try {
    runCli(['install'], { home });
    runCli(['install', '--target', 'codex'], { home });
    runCli(['install', '--target', 'cursor'], { home });

    commitBlock('I_WANT_TO_SWEAR trigger it', 'multi-target-session');

    const status = runCli(['status'], { home }).stdout;
    assert.match(status, /claude-code: not installed/);
    assert.match(status, /codex: not installed/);
    assert.match(status, /cursor: not installed/);
  } finally {
    process.env.HOME = originalHome;
  }
});
