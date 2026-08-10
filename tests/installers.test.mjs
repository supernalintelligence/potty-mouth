import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runCli, freshHome } from './helpers.mjs';
import { INSTALLERS, uninstallAll } from '../src/installers/index.mjs';

test('codex: installs to ~/.codex/hooks.json with the same nested shape as Claude Code, --target codex in the command', () => {
  const home = freshHome();
  const r = runCli(['install', '--target', 'codex'], { home });
  assert.equal(r.code, 0);

  const configPath = path.join(home, '.codex', 'hooks.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const group = config.hooks.UserPromptSubmit[0];
  assert.equal(group.hooks[0].command, 'potty-mouth hook --target codex');
  assert.equal(group.hooks[0].type, 'command');
});

test('codex: install is idempotent', () => {
  const home = freshHome();
  runCli(['install', '--target', 'codex'], { home });
  runCli(['install', '--target', 'codex'], { home });
  const config = JSON.parse(fs.readFileSync(path.join(home, '.codex', 'hooks.json'), 'utf8'));
  const matches = config.hooks.UserPromptSubmit.flatMap((g) => g.hooks).filter((h) => h.command.includes('potty-mouth hook'));
  assert.equal(matches.length, 1);
});

test('codex: uninstall removes only the potty-mouth entry, preserves unrelated hooks', () => {
  const home = freshHome();
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.codex', 'hooks.json'),
    JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: '/other/hook.sh' }] }] } }),
  );
  runCli(['install', '--target', 'codex'], { home });
  runCli(['uninstall', '--target', 'codex'], { home });

  const config = JSON.parse(fs.readFileSync(path.join(home, '.codex', 'hooks.json'), 'utf8'));
  const commands = config.hooks.UserPromptSubmit.flatMap((g) => g.hooks).map((h) => h.command);
  assert.ok(!commands.some((c) => c.includes('potty-mouth hook')));
  assert.ok(commands.includes('/other/hook.sh'));
});

test('cursor: installs to ~/.cursor/hooks.json with its own flat shape (version, no matcher/type wrapper)', () => {
  const home = freshHome();
  const r = runCli(['install', '--target', 'cursor'], { home });
  assert.equal(r.code, 0);

  const configPath = path.join(home, '.cursor', 'hooks.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(config.version, 1);
  assert.equal(config.hooks.beforeSubmitPrompt.length, 1);
  const entry = config.hooks.beforeSubmitPrompt[0];
  assert.equal(entry.command, 'potty-mouth hook --target cursor');
  assert.equal(entry.type, undefined, 'cursor entries have no "type" field, unlike claude-code/codex');
  assert.equal(entry.matcher, undefined, 'cursor has no matcher concept');
});

test('cursor: install is idempotent', () => {
  const home = freshHome();
  runCli(['install', '--target', 'cursor'], { home });
  runCli(['install', '--target', 'cursor'], { home });
  const config = JSON.parse(fs.readFileSync(path.join(home, '.cursor', 'hooks.json'), 'utf8'));
  assert.equal(config.hooks.beforeSubmitPrompt.length, 1);
});

test('cursor: uninstall removes only the potty-mouth entry, preserves unrelated hooks', () => {
  const home = freshHome();
  fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.cursor', 'hooks.json'),
    JSON.stringify({ version: 1, hooks: { beforeSubmitPrompt: [{ command: '/other/hook.sh', timeout: 5 }] } }),
  );
  runCli(['install', '--target', 'cursor'], { home });
  runCli(['uninstall', '--target', 'cursor'], { home });

  const config = JSON.parse(fs.readFileSync(path.join(home, '.cursor', 'hooks.json'), 'utf8'));
  const commands = config.hooks.beforeSubmitPrompt.map((h) => h.command);
  assert.ok(!commands.some((c) => c.includes('potty-mouth hook')));
  assert.ok(commands.includes('/other/hook.sh'));
});

test('unknown --target is rejected with a clear error, not silently defaulted', () => {
  const home = freshHome();
  const r = runCli(['install', '--target', 'notarealtool'], { home });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /Unknown --target/);
});

test('status: reports per-target install state for all three targets independently', () => {
  const home = freshHome();
  runCli(['install'], { home }); // claude-code default
  runCli(['install', '--target', 'codex'], { home });
  // cursor left uninstalled deliberately

  const status = runCli(['status'], { home }).stdout;
  assert.match(status, /claude-code: installed/);
  assert.match(status, /codex: installed/);
  assert.match(status, /cursor: not installed/);
});

test('uninstallAll: sweeps every target, never throws even when none were installed', () => {
  const home = freshHome();
  const originalHome = process.env.HOME;
  process.env.HOME = home;
  try {
    assert.doesNotThrow(() => uninstallAll());
    const results = uninstallAll();
    assert.equal(results.length, Object.keys(INSTALLERS).length);
    for (const r of results) assert.equal(r.changed, false);
  } finally {
    process.env.HOME = originalHome;
  }
});

test('uninstallAll: actually removes entries from every target that was installed', () => {
  const home = freshHome();
  runCli(['install'], { home });
  runCli(['install', '--target', 'codex'], { home });
  runCli(['install', '--target', 'cursor'], { home });

  const originalHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const results = uninstallAll();
    assert.ok(results.every((r) => r.changed === true), 'every installed target should report changed:true');
  } finally {
    process.env.HOME = originalHome;
  }

  const status = runCli(['status'], { home }).stdout;
  assert.match(status, /claude-code: not installed/);
  assert.match(status, /codex: not installed/);
  assert.match(status, /cursor: not installed/);
});
