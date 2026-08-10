import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runCli, freshHome } from './helpers.mjs';

test('install: creates settings.json with the hook wired in', () => {
  const home = freshHome();
  const r = runCli(['install'], { home });
  assert.equal(r.code, 0);
  const settingsPath = path.join(home, '.claude', 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const found = settings.hooks.UserPromptSubmit.some((g) =>
    g.hooks.some((h) => h.command.includes('potty-mouth hook')));
  assert.equal(found, true);
});

test('install: idempotent, never duplicates the entry', () => {
  const home = freshHome();
  runCli(['install'], { home });
  runCli(['install'], { home });
  runCli(['install'], { home });
  const settingsPath = path.join(home, '.claude', 'settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const matches = settings.hooks.UserPromptSubmit.flatMap((g) => g.hooks)
    .filter((h) => h.command.includes('potty-mouth hook'));
  assert.equal(matches.length, 1);
});

test('install: preserves pre-existing unrelated hooks untouched', () => {
  const home = freshHome();
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  const preexisting = {
    hooks: {
      UserPromptSubmit: [
        { hooks: [{ type: 'command', command: '/some/other/hook.sh', timeout: 2 }] },
      ],
      PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: '/pretooluse.sh' }] }],
    },
    someOtherSetting: true,
  };
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify(preexisting, null, 2));

  runCli(['install'], { home });

  const settings = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
  assert.equal(settings.someOtherSetting, true);
  assert.equal(settings.hooks.PreToolUse[0].hooks[0].command, '/pretooluse.sh');
  const commands = settings.hooks.UserPromptSubmit.flatMap((g) => g.hooks).map((h) => h.command);
  assert.ok(commands.includes('/some/other/hook.sh'), 'pre-existing UserPromptSubmit hook must survive');
  assert.ok(commands.some((c) => c.includes('potty-mouth hook')));
});

test('uninstall: removes only the potty-mouth entry, leaves everything else', () => {
  const home = freshHome();
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  const preexisting = {
    hooks: {
      UserPromptSubmit: [
        { hooks: [{ type: 'command', command: '/some/other/hook.sh' }] },
      ],
    },
  };
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify(preexisting));
  runCli(['install'], { home });
  runCli(['uninstall'], { home });

  const settings = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
  const commands = settings.hooks.UserPromptSubmit.flatMap((g) => g.hooks).map((h) => h.command);
  assert.ok(!commands.some((c) => c.includes('potty-mouth hook')));
  assert.ok(commands.includes('/some/other/hook.sh'));
});

test('uninstall: safe no-op when never installed', () => {
  const home = freshHome();
  const r = runCli(['uninstall'], { home });
  assert.equal(r.code, 0);
});

test('add/remove/list roundtrip, tagged by who added it', () => {
  const home = freshHome();
  runCli(['add', 'yeet', 'toss'], { home });
  runCli(['add', 'poopyhead'], { home }); // no swap -> [removed]
  runCli(['add', 'zonk', 'boop', '--by', 'ai'], { home });

  const list = runCli(['list'], { home }).stdout;
  assert.match(list, /yeet -> toss \(user\)/);
  assert.match(list, /poopyhead -> \[removed\] \(user\)/);
  assert.match(list, /zonk -> boop \(ai\)/);

  runCli(['remove', 'yeet'], { home });
  const list2 = runCli(['list'], { home }).stdout;
  assert.ok(!list2.includes('yeet ->'));
  assert.match(list2, /zonk -> boop \(ai\)/, 'removing one word must not affect others');
});

test('add: rejects a word shorter than 3 characters without --force', () => {
  const home = freshHome();
  const r = runCli(['add', 'he'], { home });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /shorter than 3/);
  const list = runCli(['list'], { home }).stdout;
  // Anchored to line start, not a loose substring — "douche -> jerk" ends
  // in "he ->" and would otherwise false-fail this assertion.
  assert.doesNotMatch(list, /^\s*he ->/m);
});

test('add: rejects a common English stopword without --force', () => {
  const home = freshHome();
  const r = runCli(['add', 'the'], { home });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /common English word/);
});

test('add: --force overrides both the length and stopword guard', () => {
  const home = freshHome();
  const short = runCli(['add', 'he', '--force'], { home });
  assert.equal(short.code, 0);
  const common = runCli(['add', 'the', 'darn', '--force'], { home });
  assert.equal(common.code, 0);
  const list = runCli(['list'], { home }).stdout;
  assert.match(list, /the -> darn \(user\)/);
});

test('add: legitimate short non-common word is allowed without --force', () => {
  const home = freshHome();
  const r = runCli(['add', 'yeet', 'toss'], { home });
  assert.equal(r.code, 0);
});

test('add: rejects an empty word', () => {
  const home = freshHome();
  const r = runCli(['add', ''], { home });
  assert.notEqual(r.code, 0);
});

test('add: --by must be "user" or "ai", rejects garbage', () => {
  const home = freshHome();
  const r = runCli(['add', 'yeet', 'toss', '--by', 'robot'], { home });
  assert.equal(r.code, 2);
});

test('user table additions override the seed table for matching, but seed value is restored after remove', () => {
  const home = freshHome();
  // Note: "fuck" and "fucking" are independent table keys (each conjugated
  // form is its own explicit entry, not derived) — override the exact word
  // under test, "fuck", not a different conjugation of it.
  runCli(['add', 'fuck', 'heck'], { home }); // override a seed word's swap
  const checkOverridden = runCli(['check', 'this is fuck awful'], { home }).stdout;
  assert.match(checkOverridden, /heck/);

  runCli(['remove', 'fuck'], { home });
  const checkRestored = runCli(['check', 'this is fuck awful'], { home }).stdout;
  assert.match(checkRestored, /fox/, 'removing a user override should fall back to the seed swap');
});

test('stats: reflects real counts after multiple hook invocations, including bypasses', () => {
  const home = freshHome();
  runCli(['hook'], { home, input: JSON.stringify({ prompt: 'this is fucking broken', session_id: 's1' }) });
  runCli(['hook'], { home, input: JSON.stringify({ prompt: 'I_WANT_TO_SWEAR fuck yeah', session_id: 's1' }) });
  const stats = runCli(['stats'], { home }).stdout;
  assert.match(stats, /Total blocks: 1, bypasses: 1/);
});

test('reset: zeroes counters but leaves the word table untouched', () => {
  const home = freshHome();
  runCli(['add', 'yeet', 'toss'], { home });
  runCli(['hook'], { home, input: JSON.stringify({ prompt: 'this is fucking broken', session_id: 's1' }) });

  const before = runCli(['stats'], { home }).stdout;
  assert.match(before, /Total blocks: 1/);

  const resetOut = runCli(['reset'], { home }).stdout;
  assert.match(resetOut, /Word table untouched/);

  const after = runCli(['stats'], { home }).stdout;
  assert.match(after, /Total blocks: 0, bypasses: 0/);

  const list = runCli(['list'], { home }).stdout;
  assert.match(list, /yeet -> toss/, 'table must survive a counter reset');
});

test('check: reports clean vs blocked correctly, with cleaned-text preview on strict matches', () => {
  const clean = runCli(['check', 'please review this diff']).stdout;
  assert.match(clean, /clean/);

  const blocked = runCli(['check', 'this shit is broken']).stdout;
  assert.match(blocked, /BLOCKED/);
  assert.match(blocked, /junk/);
});

test('check: an ambiguous fuzzy-only match (no safe swap) reports that explicitly, not a silently-unchanged "cleaned version"', () => {
  const out = runCli(['check', 'what the actual f*ck is this']).stdout;
  assert.match(out, /BLOCKED/);
  assert.match(out, /no safe swap applied/);
});

test('session count pruning: adding a 101st distinct session drops the oldest, caps at 100', () => {
  const home = freshHome();
  fs.mkdirSync(path.join(home, '.potty-mouth'), { recursive: true });
  // Seed 100 fake sessions directly (spawning 100 real hook processes would
  // be slow and this exercises the exact same pruneSessions() code path).
  const sessions = {};
  for (let i = 0; i < 100; i++) {
    sessions[`fake-session-${i}`] = {
      blocks: 1,
      bypasses: 0,
      lastNotifiedCount: 0,
      lastActivityAt: new Date(2020, 0, 1, 0, i).toISOString(),
    };
  }
  fs.writeFileSync(
    path.join(home, '.potty-mouth', 'state.json'),
    JSON.stringify({ totalBlocks: 100, totalBypasses: 0, sessions }),
  );

  runCli(['hook'], { home, input: JSON.stringify({ prompt: 'this is fucking broken', session_id: 'newest' }) });

  const state = JSON.parse(fs.readFileSync(path.join(home, '.potty-mouth', 'state.json'), 'utf8'));
  const sessionIds = Object.keys(state.sessions);
  assert.ok(sessionIds.length <= 100, `expected <=100 sessions, got ${sessionIds.length}`);
  assert.ok(sessionIds.includes('newest'), 'newest session must survive pruning');
  assert.ok(!sessionIds.includes('fake-session-0'), 'oldest session must be pruned out');
});
