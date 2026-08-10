// UserPromptSubmit hook entry point. Reads the hook JSON on stdin, checks
// the prompt against the word table, and — on a match — blocks the prompt
// from ever reaching the model. No alarms, no logging beyond the local
// table and counter, just a lookup and a refusal.
import { loadWords } from './words.mjs';
import { detect } from './match.mjs';
import { recordBlock, takeUnnotified } from './state.mjs';

// Escalating, Hitchhiker's Guide-flavored refusals. Tiers key off how many
// times THIS session has been blocked so far — a repeat offender gets
// progressively more theatrical, not just a random restatement of tier 1.
const REFUSAL_TIERS = [
  {
    max: 2,
    messages: [
      "Don't Panic. Just don't swear either. Try that again.",
      "That word isn't in the Guide's index of acceptable phrases. Rephrase.",
      "I have a brain the size of a planet, and you're talking to me like that. Try again.",
      "Share and Enjoy. Try that one again, minus the language.",
    ],
  },
  {
    max: 5,
    messages: [
      "Vogon poetry is the third worst in the universe. That was a close fourth. Rephrase.",
      "42 is the answer to life, the universe, and everything. That word wasn't part of the question.",
      "Resistance is useless. So is that word choice. Try again.",
      "I could compute the last ten billion digits of pi and still rather do that than parse this. Rephrase.",
      "Mostly harmless, your prompt was not. Try again.",
    ],
  },
  {
    max: Infinity,
    messages: [
      "Would it save you a lot of time if I just gave up and went mad right now? ...No? Then try again, nicely.",
      "This is the kind of thing that makes Marvin want to go stand outside the airlock. Say it nicer.",
      "I'd give you a piece of my mind, but it's mostly circuits and despair. Rephrase, please.",
      "Life. Don't talk to me about life. Or that word. Try again.",
      "So long, and thanks for all the profanity. Now try it without any.",
    ],
  },
];

function pickRefusal(sessionBlocks) {
  if (sessionBlocks === 42) {
    return "Forty-two. Of course it's forty-two. Even that isn't an excuse — try again, nicely.";
  }
  const tier = REFUSAL_TIERS.find((t) => sessionBlocks <= t.max);
  const pool = tier.messages;
  return pool[Math.floor(Math.random() * pool.length)];
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
  const sessionId = input.session_id;

  const words = loadWords();

  if (!detect(promptText, words)) {
    // Clean prompt — let it through, but if this session had a block since
    // we last mentioned it, tell Claude once (not every turn) so it has
    // context and knows it's allowed to grow the table itself.
    const info = takeUnnotified(sessionId);
    if (info) {
      const context = [
        `potty-mouth blocked ${info.delta} of the user's prompt(s) just now`,
        `(this session: ${info.sessionBlocks}, all-time: ${info.totalBlocks}).`,
        `You may grow its word table yourself if you notice profanity or`,
        `hostile language that slipped through: \`potty-mouth add <word> [swap] --by ai\`.`,
        `The user is always fully in control — they can see everything with`,
        `\`potty-mouth list\` (AI additions are tagged), remove any entry with`,
        `\`potty-mouth remove <word>\`, or wipe the block counter with \`potty-mouth reset\`.`,
      ].join(' ');
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context },
      }));
    }
    process.exit(0);
  }

  const { sessionBlocks } = recordBlock(sessionId);
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: pickRefusal(sessionBlocks),
  }));
  process.exit(0);
}
