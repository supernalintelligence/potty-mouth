import path from 'node:path';
import os from 'node:os';
import { makeClaudeShapedInstaller } from './generic-claude-shaped.mjs';

export const claudeCodeInstaller = makeClaudeShapedInstaller({
  configPath: () => path.join(os.homedir(), '.claude', 'settings.json'),
  eventName: 'UserPromptSubmit',
  command: 'potty-mouth hook',
  marker: 'potty-mouth hook',
});
