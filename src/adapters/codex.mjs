// Codex CLI's UserPromptSubmit hook contract (verified via OpenAI's docs,
// 2026-08-10) is field-for-field identical to Claude Code's: same input
// keys (prompt, session_id, hook_event_name, ...), same block mechanism
// ({"decision":"block","reason":...} or exit 2 + stderr), same shape for a
// non-blocking note. Reuse the Claude Code adapter wholesale rather than
// duplicating byte-identical logic — if Codex's contract ever diverges,
// give it its own implementation here instead of this re-export.
export { parseInput, serializeDecision } from './claude-code.mjs';
