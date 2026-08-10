// Cursor's beforeSubmitPrompt hook contract (verified via cursor.com/docs,
// 2026-08-10) is genuinely different from Claude Code/Codex, not just a
// renamed field or two:
//   input:  { prompt, attachments, conversation_id, generation_id, model }
//           — no session_id; conversation_id is the closest analog, used
//           for per-conversation block counting / notify-once.
//   output: { continue: true | false, user_message: "..." }
//           — user_message is ONLY shown when continue:false (confirmed in
//           docs: "shown when the prompt is blocked"). There is no
//           documented mechanism for a non-blocking note to the model the
//           way Claude Code's hookSpecificOutput.additionalContext works —
//           so an `action: 'allow', context: ...` Decision (the bypass
//           notice, the "you were blocked N times" notice) has nowhere to
//           go on this target and is silently dropped rather than guessing
//           at an unconfirmed field. The prompt still gets through either
//           way; only the informational aside is lost.
export function parseInput(raw) {
  const input = JSON.parse(raw);
  return {
    promptText: input.prompt ?? '',
    sessionId: input.conversation_id,
  };
}

export function serializeDecision(decision) {
  if (decision.action === 'block') {
    return JSON.stringify({ continue: false, user_message: decision.reason });
  }
  return JSON.stringify({ continue: true });
}
