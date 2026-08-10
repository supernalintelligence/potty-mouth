// ~/.cursor/hooks.json — a genuinely different shape from Claude Code/Codex
// (verified via cursor.com/docs, 2026-08-10): a top-level "version", and
// flat { command, timeout } entries directly under hooks.beforeSubmitPrompt
// — no per-group "hooks: [...]" wrapper, no "matcher", no "type". Gets its
// own install/uninstall rather than the generic factory, since the shape
// doesn't match it.
//
// failClosed is deliberately left unset (defaults to false per Cursor's
// docs — a crashed/timed-out hook lets the prompt through). That default
// already matches potty-mouth's own fail-open philosophy, so there's
// nothing to override here.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const EVENT = 'beforeSubmitPrompt';
const MARKER = 'potty-mouth hook --target cursor';

function configPath() {
  return path.join(os.homedir(), '.cursor', 'hooks.json');
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeConfig(config) {
  const file = configPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

function install() {
  const config = readConfig();
  config.version ??= 1;
  config.hooks ??= {};
  config.hooks[EVENT] ??= [];

  const alreadyThere = config.hooks[EVENT].some((h) => h.command?.includes('potty-mouth hook'));
  if (alreadyThere) return { changed: false, path: configPath() };

  config.hooks[EVENT].push({ command: MARKER, timeout: 10 });
  writeConfig(config);
  return { changed: true, path: configPath() };
}

function uninstall() {
  const config = readConfig();
  const list = config.hooks?.[EVENT];
  if (!Array.isArray(list)) return { changed: false, path: configPath() };

  const before = list.length;
  config.hooks[EVENT] = list.filter((h) => !h.command?.includes('potty-mouth hook'));
  const changed = config.hooks[EVENT].length !== before;

  if (changed) writeConfig(config);
  return { changed, path: configPath() };
}

function isInstalled() {
  const config = readConfig();
  return (config.hooks?.[EVENT] ?? []).some((h) => h.command?.includes('potty-mouth hook'));
}

export const cursorInstaller = { install, uninstall, isInstalled, configPath };
