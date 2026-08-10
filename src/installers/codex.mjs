import path from 'node:path';
import os from 'node:os';
import { makeClaudeShapedInstaller } from './generic-claude-shaped.mjs';

// ~/.codex/hooks.json, same nested shape as Claude Code's settings.json —
// see generic-claude-shaped.mjs's header comment for the source citation.
// The installed command explicitly passes --target codex so the right
// adapter is used regardless of potty-mouth's own default.
export const codexInstaller = makeClaudeShapedInstaller({
  configPath: () => path.join(os.homedir(), '.codex', 'hooks.json'),
  eventName: 'UserPromptSubmit',
  command: 'potty-mouth hook --target codex',
  marker: 'potty-mouth hook',
});
