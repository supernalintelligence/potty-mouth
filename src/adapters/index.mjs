import * as claudeCode from './claude-code.mjs';
import * as codex from './codex.mjs';
import * as cursor from './cursor.mjs';

export const ADAPTERS = {
  'claude-code': claudeCode,
  codex,
  cursor,
};

export const DEFAULT_TARGET = 'claude-code';

export function getAdapter(target) {
  const adapter = ADAPTERS[target ?? DEFAULT_TARGET];
  if (!adapter) {
    throw new Error(`Unknown target "${target}" — expected one of: ${Object.keys(ADAPTERS).join(', ')}`);
  }
  return adapter;
}
