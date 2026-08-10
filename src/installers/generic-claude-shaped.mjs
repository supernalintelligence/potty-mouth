// Shared installer logic for any target using Claude Code's own hook config
// shape: { hooks: { <eventName>: [{ matcher, hooks: [{ type, command,
// timeout }] }] } }. Confirmed identical for both real targets that use
// it — Claude Code's own settings.json, and Codex CLI's hooks.json (per
// OpenAI's docs, 2026-08-10: same nested hooks-array-of-groups shape,
// same {"decision":"block"} contract). Idempotent: checks for an existing
// potty-mouth entry by command substring before adding, never duplicates,
// preserves every other hook and setting already in the file.
import fs from 'node:fs';
import path from 'node:path';

export function makeClaudeShapedInstaller({ configPath, eventName, command, marker }) {
  function readConfig() {
    const file = configPath();
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return {};
    }
  }

  function writeConfig(config) {
    const file = configPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n', 'utf8');
  }

  function findEntry(config) {
    const list = config.hooks?.[eventName] ?? [];
    return list.some((group) => (group.hooks ?? []).some((h) => h.command?.includes(marker)));
  }

  function install() {
    const config = readConfig();
    config.hooks ??= {};
    config.hooks[eventName] ??= [];

    if (findEntry(config)) {
      return { changed: false, path: configPath() };
    }

    config.hooks[eventName].push({
      matcher: '*',
      hooks: [{ type: 'command', command, timeout: 10 }],
    });

    writeConfig(config);
    return { changed: true, path: configPath() };
  }

  function uninstall() {
    const config = readConfig();
    const list = config.hooks?.[eventName];
    if (!Array.isArray(list)) return { changed: false, path: configPath() };

    let changed = false;
    config.hooks[eventName] = list
      .map((group) => {
        const hooks = (group.hooks ?? []).filter((h) => !h.command?.includes(marker));
        if (hooks.length !== (group.hooks ?? []).length) changed = true;
        return { ...group, hooks };
      })
      .filter((group) => group.hooks.length > 0);

    if (changed) writeConfig(config);
    return { changed, path: configPath() };
  }

  function isInstalled() {
    return findEntry(readConfig());
  }

  return { install, uninstall, isInstalled, configPath };
}
