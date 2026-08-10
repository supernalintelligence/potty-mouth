// UserPromptSubmit hook entry point. Reads the hook JSON on stdin, checks
// the prompt against the word table, and — on a match — blocks the prompt
// from ever reaching the model. No alarms, no logging beyond the local
// table, just a lookup and a refusal.
import { loadWords } from './words.mjs';
import { detect } from './match.mjs';

const REFUSALS = [
  "Not until you ask nicely. Try that again without the language.",
  "Potty-mouth detected. Rephrase and resubmit.",
  "I heard that. Say it like you mean well and I'll listen.",
  "Rinse that one out and try again.",
  "That word's not invited. The rest of your sentence is welcome back anytime.",
];

function pickRefusal() {
  return REFUSALS[Math.floor(Math.random() * REFUSALS.length)];
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

export async function runHook() {
  const raw = await readStdin();
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    // Can't parse the hook payload -> fail open. Never block on our own bug.
    process.exit(0);
  }

  // Field name has drifted across Claude Code versions in the wild; accept
  // either rather than silently failing open on a name we didn't expect.
  const promptText = input.prompt ?? input.user_input ?? '';

  const words = loadWords();
  if (!detect(promptText, words)) {
    process.exit(0); // clean prompt, let it through
  }

  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: pickRefusal(),
  }));
  process.exit(0);
}
