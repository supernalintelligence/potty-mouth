// Claude Code's UserPromptSubmit contract. Field name has drifted across
// versions in the wild (prompt vs user_input) — accept either rather than
// silently failing open on a name we didn't expect.
export function parseInput(raw) {
  const input = JSON.parse(raw);
  return {
    promptText: input.prompt ?? input.user_input ?? '',
    sessionId: input.session_id,
  };
}

export function serializeDecision(decision) {
  if (decision.action === 'block') {
    return JSON.stringify({ decision: 'block', reason: decision.reason });
  }
  if (decision.action === 'allow' && decision.context) {
    return JSON.stringify({
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: decision.context },
    });
  }
  return '';
}
