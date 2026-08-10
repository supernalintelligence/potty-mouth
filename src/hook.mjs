// UserPromptSubmit hook entry point. Reads the hook JSON on stdin, checks
// the prompt against the word table, and — on a match — blocks the prompt
// from ever reaching the model. No alarms, no logging beyond the local
// table and counter, just a lookup and a refusal.
import { loadWords, SEED_FUZZY_ROOTS } from './words.mjs';
import { detect } from './match.mjs';
import { recordBlock, recordBypass, takeUnnotified } from './state.mjs';

// Explicit, deliberate override — type this anywhere in a prompt and
// potty-mouth lets that prompt through untouched, on purpose, no matter
// what it contains. Exact case-sensitive token so it can't trigger by
// accident. This is the escalation past the word table itself: the user
// (a human typing into their own terminal) is always allowed to override
// their own filter — potty-mouth just makes sure Claude is told it happened
// rather than silently letting profanity through unremarked.
const BYPASS_TOKEN = 'I_WANT_TO_SWEAR';

// The UserPromptSubmit channel isn't exclusively human keystrokes — Claude
// Code also delivers things like background-task completion reports through
// it, wrapped in a recognized envelope tag, as if they were the next typed
// message. Confirmed incident 2026-08-09: a multi-thousand-character
// <task-notification> build report got blocked over an incidental word
// match, destroying real operational content nobody "asked nicely" for
// (the whole premise doesn't apply to non-human content). Never run word
// detection against a recognized system envelope — pass it through
// untouched, no counting, no context injection, this isn't a conversation
// turn.
const SYSTEM_ENVELOPE_TAGS = ['task-notification', 'system-reminder'];

function isSystemEnvelope(text) {
  const trimmed = text.trimStart();
  return SYSTEM_ENVELOPE_TAGS.some((tag) => trimmed.startsWith(`<${tag}>`));
}

// Defense in depth, independent of the tag check above: a human typing
// profanity at Claude is virtually always short. A very long prompt is far
// more likely to be pasted technical content (logs, reports, code) than a
// live conversational message, and the cost of a false positive on a huge
// paste (destroying content the user needed) vastly outweighs the value of
// blocking it. Detection simply never runs above this length.
const MAX_SCANNED_LENGTH = 4000;

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

function emitContext(lines) {
  if (lines.length === 0) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: lines.join(' ') },
  }));
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

  if (isSystemEnvelope(promptText) || promptText.length > MAX_SCANNED_LENGTH) {
    process.exit(0); // not a human conversation turn -> never touch it
  }

  const usedBypass = promptText.includes(BYPASS_TOKEN);

  if (!usedBypass) {
    const words = loadWords();
    if (detect(promptText, words, SEED_FUZZY_ROOTS)) {
      const { sessionBlocks } = recordBlock(sessionId);
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason: pickRefusal(sessionBlocks),
      }));
      process.exit(0);
    }
  }

  // Allowed — either clean, or the user explicitly overrode the filter.
  // Either way, make sure Claude has context rather than staying silent.
  const contextLines = [];

  if (usedBypass) {
    const { sessionBypasses, totalBypasses } = recordBypass(sessionId);
    contextLines.push(
      `The user just typed the potty-mouth bypass phrase (${BYPASS_TOKEN}) — this`,
      `means they deliberately chose to speak freely this turn; anything in this`,
      `prompt was intentionally let through, not a filter failure`,
      `(bypasses this session: ${sessionBypasses}, all-time: ${totalBypasses}).`,
      `Respond normally.`,
    );
  }

  const info = takeUnnotified(sessionId);
  if (info) {
    contextLines.push(
      `potty-mouth blocked ${info.delta} of the user's earlier prompt(s)`,
      `(this session: ${info.sessionBlocks}, all-time: ${info.totalBlocks}).`,
      `You may grow its word table yourself if you notice profanity or hostile`,
      `language that slipped through: \`potty-mouth add <word> [swap] --by ai\`.`,
      `The user is always fully in control — they can see everything with`,
      `\`potty-mouth list\` (AI additions are tagged), remove any entry with`,
      `\`potty-mouth remove <word>\`, or wipe the block counter with \`potty-mouth reset\`.`,
    );
  }

  emitContext(contextLines);
  process.exit(0);
}
