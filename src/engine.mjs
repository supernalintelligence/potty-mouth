// The ONE decision engine. Every target adapter (Claude Code, Codex, Cursor,
// whatever comes next) normalizes its own tool's stdin shape into
// { promptText, sessionId }, calls decide() here, and translates the
// returned Decision back into that tool's own output contract. All
// detection, bypass, envelope/length guards, kill-switch, and counter logic
// lives HERE ONCE — adapters never contain decision logic, only translation.
import { loadWords, SEED_FUZZY_ROOTS } from './words.mjs';
import { detect } from './match.mjs';
import { recordBlock, recordBypass, takeUnnotified } from './state.mjs';
import { isDisabled, disable } from './killswitch.mjs';

// Explicit, deliberate override — type this anywhere in a prompt and
// potty-mouth lets that prompt through untouched, on purpose, no matter
// what it contains. Exact case-sensitive token so it can't trigger by
// accident. This is the escalation past the word table itself: the user
// (a human typing into their own terminal) is always allowed to override
// their own filter — potty-mouth just makes sure the model is told it
// happened rather than silently letting profanity through unremarked.
export const BYPASS_TOKEN = 'I_WANT_TO_SWEAR';

// The prompt-submission channel isn't exclusively human keystrokes — tools
// also deliver things like background-task completion reports through it,
// wrapped in a recognized envelope tag, as if they were the next typed
// message. Confirmed incident 2026-08-09 (Claude Code): a multi-thousand-
// character <task-notification> build report got blocked over an
// incidental word match, destroying real operational content nobody
// "asked nicely" for (the whole premise doesn't apply to non-human
// content). Never run word detection against a recognized system
// envelope — pass it through untouched, no counting, no context, this
// isn't a conversation turn.
const SYSTEM_ENVELOPE_TAGS = ['task-notification', 'system-reminder'];

function isSystemEnvelope(text) {
  const trimmed = text.trimStart();
  return SYSTEM_ENVELOPE_TAGS.some((tag) => trimmed.startsWith(`<${tag}>`));
}

// Defense in depth, independent of the tag check above: a human typing
// profanity at an assistant is virtually always short. A very long prompt
// is far more likely to be pasted technical content (logs, reports, code)
// than a live conversational message, and the cost of a false positive on
// a huge paste (destroying content the user needed) vastly outweighs the
// value of blocking it. Detection simply never runs above this length.
const MAX_SCANNED_LENGTH = 4000;

// Escalating, Hitchhiker's Guide-flavored refusals. Tiers key off how many
// times THIS conversation has been blocked so far — a repeat offender gets
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

// The exact header potty-mouth's own block notices render as in a terminal.
// Confirmed real incident (2026-08-10): a rejected prompt's on-screen
// notice — this header, the refusal reason, AND the "Original prompt: ..."
// echo — got resubmitted verbatim as the NEXT prompt (most likely a
// copy-paste that grabbed the notice along with the intended retry). Since
// the original profanity is still embedded in that resubmitted text, it
// blocks again, nesting deeper each time and burying the actual reason
// under a wall of quoted rejection text. Detection was correct both times —
// the confusing part was giving no clue what actually happened. A generic
// random refusal doesn't help here; naming the loop explicitly does.
const SELF_REFERENCE_SIGNATURE = 'UserPromptSubmit operation blocked by hook';

function pickRefusal(sessionBlocks, promptText) {
  if (promptText.includes(SELF_REFERENCE_SIGNATURE)) {
    return "That's a previous rejection notice, pasted back in — not a new message. " +
      'Retype what you actually meant to say, without copying the notice text along with it.';
  }
  if (sessionBlocks === 42) {
    return "Forty-two. Of course it's forty-two. Even that isn't an excuse — try again, nicely.";
  }
  const tier = REFUSAL_TIERS.find((t) => sessionBlocks <= t.max);
  return tier.messages[Math.floor(Math.random() * tier.messages.length)];
}

// The SOLE gateway a block decision may ever be produced through — every
// call site in decide() must route through here, never construct a
// { action: 'block' } Decision directly. Re-checks the bypass token
// independently of whatever upstream logic decided to call this, so a
// FUTURE bug (a new detection path, a broken condition, anything) that
// forgets to respect the bypass still can't produce a real block while
// it's present — the invariant is enforced here, once, not trusted to
// every caller.
//
// If it ever fires despite the bypass token being present, that's not a
// user "sneaking past" anything (BYPASS_TOKEN is a literal substring check
// against their own typed text — nothing to sneak past) — it means
// potty-mouth's own logic has a contradiction it cannot explain. Rather
// than keep blocking on logic that's already proven wrong once, this
// disables the whole filter (word table stays intact, only the hook itself
// goes inert, across EVERY installed target) and asks for a bug report.
export function commitBlock(promptText, sessionId) {
  if (promptText.includes(BYPASS_TOKEN)) {
    disable(
      'Automatic: a block decision was about to fire despite the bypass token being present. ' +
      'This should be structurally impossible and indicates a real bug in potty-mouth.',
      { automatic: true, promptExcerpt: promptText.slice(0, 200), sessionId },
    );
    return {
      action: 'allow',
      context: [
        '⚠️ potty-mouth just detected an internal contradiction it cannot explain (a block was about',
        "to fire despite the user's explicit bypass phrase being present) and has AUTOMATICALLY",
        'DISABLED ITSELF as a safety measure, across every target it was installed for — it will not',
        'filter or block anything further until re-enabled. Please tell the user this happened and',
        "suggest they file a bug report against potty-mouth (include what they typed, if they're",
        "willing) — run `potty-mouth status` for details. Run `potty-mouth enable` and then",
        '`potty-mouth install` once the underlying bug is understood and fixed.',
      ].join(' '),
    };
  }
  const { sessionBlocks } = recordBlock(sessionId);
  return { action: 'block', reason: pickRefusal(sessionBlocks, promptText) };
}

// Decision shapes:
//   { action: 'allow' }                     -- pass through, no output needed
//   { action: 'allow', context: string }    -- pass through, but tell the model something
//   { action: 'block', reason: string }     -- refuse, prompt never reaches the model
export function decide({ promptText, sessionId }) {
  if (isDisabled()) return { action: 'allow' };

  if (isSystemEnvelope(promptText) || promptText.length > MAX_SCANNED_LENGTH) {
    return { action: 'allow' }; // not a human conversation turn -> never touch it
  }

  const usedBypass = promptText.includes(BYPASS_TOKEN);

  if (!usedBypass) {
    const words = loadWords();
    if (detect(promptText, words, SEED_FUZZY_ROOTS)) {
      return commitBlock(promptText, sessionId);
    }
  }

  // Allowed — either clean, or the user explicitly overrode the filter.
  // Either way, make sure the model has context rather than staying silent.
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

  return contextLines.length > 0 ? { action: 'allow', context: contextLines.join(' ') } : { action: 'allow' };
}
