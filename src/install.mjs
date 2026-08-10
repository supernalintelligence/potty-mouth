// Wires (and unwires) the hook into ~/.claude/settings.json's UserPromptSubmit
// array. Idempotent: checks for an existing potty-mouth entry by command
// substring before adding, never duplicates, preserves every other hook and
// setting already in the file.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const MARKER = 'potty-mouth hook';

function settingsPath() {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

function readSettings() {
  const file = settingsPath();
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(settings) {
  const file = settingsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

function findEntry(settings) {
  const list = settings.hooks?.UserPromptSubmit ?? [];
  for (const group of list) {
    for (const h of group.hooks ?? []) {
      if (h.command?.includes(MARKER)) return true;
    }
  }
  return false;
}

export function install() {
  const settings = readSettings();
  settings.hooks ??= {};
  settings.hooks.UserPromptSubmit ??= [];

  if (findEntry(settings)) {
    return { changed: false, path: settingsPath() };
  }

  settings.hooks.UserPromptSubmit.push({
    matcher: '*',
    hooks: [
      {
        type: 'command',
        command: 'potty-mouth hook',
        timeout: 10,
      },
    ],
  });

  writeSettings(settings);
  return { changed: true, path: settingsPath() };
}

export function uninstall() {
  const settings = readSettings();
  const list = settings.hooks?.UserPromptSubmit;
  if (!Array.isArray(list)) return { changed: false, path: settingsPath() };

  let changed = false;
  settings.hooks.UserPromptSubmit = list
    .map((group) => {
      const hooks = (group.hooks ?? []).filter((h) => !h.command?.includes(MARKER));
      if (hooks.length !== (group.hooks ?? []).length) changed = true;
      return { ...group, hooks };
    })
    .filter((group) => group.hooks.length > 0);

  if (changed) writeSettings(settings);
  return { changed, path: settingsPath() };
}
