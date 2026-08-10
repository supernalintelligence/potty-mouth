import { claudeCodeInstaller } from './claude-code.mjs';
import { codexInstaller } from './codex.mjs';
import { cursorInstaller } from './cursor.mjs';

export const INSTALLERS = {
  'claude-code': claudeCodeInstaller,
  codex: codexInstaller,
  cursor: cursorInstaller,
};

export const DEFAULT_TARGET = 'claude-code';

export function getInstaller(target) {
  const installer = INSTALLERS[target ?? DEFAULT_TARGET];
  if (!installer) {
    throw new Error(`Unknown target "${target}" — expected one of: ${Object.keys(INSTALLERS).join(', ')}`);
  }
  return installer;
}

// Used by the kill switch: "nuclear" means everywhere, not just whichever
// target happened to trigger it. Never throws — a missing/unreadable
// config for a target that was never installed there is just a no-op for
// that target, not a failure of the whole sweep.
export function uninstallAll() {
  return Object.entries(INSTALLERS).map(([target, installer]) => {
    try {
      return { target, ...installer.uninstall() };
    } catch (e) {
      return { target, changed: false, error: e.message };
    }
  });
}
