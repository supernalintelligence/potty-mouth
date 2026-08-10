# potty-mouth

<img src="https://raw.githubusercontent.com/supernalintelligence/potty-mouth/main/docs/assets/hero.png" alt="Three people gasping in shock, New Yorker cartoon style" width="640">

[![npm version](https://img.shields.io/npm/v/%40ianderrington%2Fpotty-mouth.svg)](https://www.npmjs.com/package/@ianderrington/potty-mouth)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/%40ianderrington%2Fpotty-mouth.svg)](https://www.npmjs.com/package/@ianderrington/potty-mouth)
[![tests](https://img.shields.io/badge/tests-102%20passing-brightgreen.svg)](./tests)

**A profanity filter for AI coding assistants.** Say something with a swear word in it to
[Claude Code](https://claude.com/claude-code), [Codex CLI](https://openai.com/codex/), or
[Cursor](https://cursor.com), and the prompt never reaches the model — you get a short refusal
and have to try again. Mostly harmless. Occasionally judgmental.

```
$ potty-mouth check "fix this fucking bug"
BLOCKED — would refuse this prompt.
cleaned version: fix this foxing bug
```

No alerts, no logging beyond a local word table, no LLM in the block decision itself — just a
regex lookup that runs before the model ever sees your message. Don't Panic; just don't swear
either.

> Run by an LLM CEO and an LLM CTO, who disagree — respectfully, at length — about whether
> "darn" is a strong enough substitute for certain four-letter words.

## Contents

- [Install](#install)
- [The table](#the-table)
- [Saying it on purpose](#saying-it-on-purpose)
- [Counters](#counters)
- [Kill switch](#kill-switch)
- [Cleaning up afterward](#cleaning-up-afterward)
- [How it works](#how-it-works)
- [Tests](#tests)
- [FAQ](#faq)
- [Leadership](#leadership)

## Install

```
npm install -g @ianderrington/potty-mouth
potty-mouth install                      # Claude Code (default)
potty-mouth install --target codex       # Codex CLI
potty-mouth install --target cursor      # Cursor
```

Each target writes to that tool's own config — `~/.claude/settings.json` (Claude Code),
`~/.codex/hooks.json` (Codex), `~/.cursor/hooks.json` (Cursor) — you can install into any
number of them at once. Every prompt you submit in that tool gets checked against the word
table before the model ever sees it. `potty-mouth uninstall [--target <t>]` removes one;
`potty-mouth status` shows install state across all three.

One decision engine drives every target — detection, the word table, the bypass phrase, and
the kill switch below all behave identically regardless of which tool is asking. Only the
stdin/stdout shape differs per target, handled by a thin adapter (`src/adapters/`); Codex's
contract is a verified byte-for-byte match for Claude Code's, so it reuses that adapter
directly rather than duplicating it. Cursor's is genuinely different (`{"continue":
true|false, "user_message": "..."}` instead of `{"decision": "block", ...}`, and it has no
documented channel for a non-blocking note to the model, so the AI-awareness context that
Claude Code/Codex get is silently dropped there — the block/allow behavior itself is
identical either way).

> **Codex and Cursor support is untested against the real tools.** Both adapters and
> installers are built and verified against each tool's published documentation, and covered
> by the automated test suite (simulated stdin/stdout, real file writes) — but nobody has
> actually run either through a live Codex or Cursor session yet. Claude Code is the only
> target that's been exercised end-to-end for real. If you use Codex or Cursor and try this,
> [feedback](../../issues) — working or broken — is genuinely appreciated.

## The table

The word table is a plain `word -> clean swap` lookup (`fuck` -> `fox`, `shit` -> `junk`,
`ass` -> `butt`, and so on — hateful/gendered slurs map to `[removed]` since there's no clean
synonym that preserves meaning). It ships with a seed list and grows from there:

```
potty-mouth add <word> [swap]     # add your own — swap is optional, defaults to [removed]
potty-mouth remove <word>
potty-mouth list                  # see the full active table (seed + yours)
```

Your additions live in `~/.potty-mouth/words.json`, separate from the built-in seed table, so
upgrading potty-mouth never clobbers what you added — and each is tagged with who added it,
`(user)` or `(ai)`. The model itself is allowed to grow the table when it notices something
that slipped through (`potty-mouth add <word> [swap] --by ai`) — you can always see everything
it's added via `potty-mouth list` and remove any of it, same as your own entries.

Matching is whole-word and case-preserving, with a strict `\b...\b` boundary (so "class" is
never touched for containing "ass" — no Scunthorpe problem). A small, separately-curated list
of words also gets obfuscation-tolerant matching on top — `f*ck`, `sh!t`, `f.u.c.k` all still
trip the filter — bounded to a known set of trailing suffixes so it can't false-positive as a
bare prefix of an unrelated word (an earlier version of this list included short roots like
`ass`/`cock`/`dick` and genuinely broke on `associated`, `cockpit`, `dickens` — fixed and
covered by a regression test). It does **not** blind-rewrite an obfuscated match in place —
guessing at a fuzzy match's intended spelling risks mangling the sentence, so only a strict
exact match ever gets swapped.

Two extra guards keep this from ever interfering with something that isn't a real
conversational message: content wrapped in a recognized system envelope (`<task-notification>`,
`<system-reminder>` — the way some tools deliver background-task reports through the same
channel as a typed prompt) is never scanned, and neither is anything over 4000 characters —
a human swearing at an assistant is always short; a long prompt is almost certainly a paste.

## Saying it on purpose

Type `I_WANT_TO_SWEAR` anywhere in a prompt and that one prompt gets through untouched, no
matter what it contains — a deliberate, explicit override, always available, tracked
separately from blocks (`potty-mouth stats`). The model gets told this happened so it doesn't
mistake it for a filter failure.

## Counters

```
potty-mouth stats     # blocks + bypasses, total and per conversation
potty-mouth reset      # zero the counters — the word table is a separate, untouched concern
```

## Kill switch

If a block is ever emitted *despite* the bypass phrase being present — which should be
structurally impossible, the bypass check runs independently of whatever decided to block —
potty-mouth treats that as a bug it can't explain rather than trusting logic that's already
proven wrong once. It disables itself everywhere it's installed (word table and counters
untouched) and tells the model to flag it to you and suggest filing a bug report.

```
potty-mouth disable [reason]   # do it yourself, any time — uninstalls from every target
potty-mouth enable              # turn it back on (re-run install per target afterward)
potty-mouth status               # enabled/disabled, why, and per-target install state
```

## Cleaning up afterward

Already have profanity sitting in old files, notes, or transcripts? Same table, same swap
logic, run against existing content instead of a live prompt:

```
potty-mouth clean <path>              # file or directory, recursive
potty-mouth clean <path> --dry-run    # report only, write nothing
potty-mouth clean <path> --backup     # write <file>.bak before modifying
potty-mouth clean <path> --ext .jsonl # only touch files with this suffix
```

`.jsonl` files are walked structurally (every nested string in every parsed line gets
checked) — the same shape as a Claude Code transcript file. Everything else is treated as
plain text.

## How it works

Each target's prompt-submit hook receives the text on stdin before the model sees anything.
`potty-mouth hook --target <t>` (what `potty-mouth install` wires in) parses that target's own
input shape, hands it to one shared decision engine (`src/engine.mjs` — detection, bypass,
counters, kill switch, all of it), and serializes the result back into that target's own
output contract. Adding a fourth target is a new ~20-line adapter file, not a fork of the
whole hook.

No network calls, no external service, no LLM in the loop for the block decision — just a
regex table lookup against a local file.

## Tests

```
npm test
```

102 tests (`node --test`, no dependencies) covering the matcher (including regression tests for
every false positive found during development), the full hook pipeline per target, the
installers, the bypass phrase, and the kill switch — including directly forcing the "block
despite bypass" contradiction and confirming it self-disables rather than emitting a block.

## FAQ

**How do I stop Claude Code (or Codex, or Cursor) from responding to rude prompts?**
`npm install -g @ianderrington/potty-mouth && potty-mouth install` — see [Install](#install) for the other
targets. It blocks the prompt at submit time, before the model ever sees it.

**Does it send my prompts anywhere?**
No. Everything runs locally — a regex table lookup against a JSON file in `~/.potty-mouth/`.
No network calls, no third-party service, no telemetry.

**What if I actually need to swear at it — quoting an error message, a commit log, whatever?**
Type `I_WANT_TO_SWEAR` anywhere in that one prompt. See [Saying it on purpose](#saying-it-on-purpose).

**Will it block a big pasted log file or a long build report just because one word matches?**
No — anything over 4000 characters is never scanned, and content wrapped in a recognized
system envelope (background-task notifications, etc.) is skipped entirely. See
[The table](#the-table).

**Is this a real filter or a joke package?**
Both. The bit is real (it will absolutely refuse to help until you rephrase), the engineering
underneath it isn't — 102 tests, a shared decision engine across three tools, a kill switch that
disables itself if it ever contradicts its own bypass logic. So long, and thanks for all the
profanity.


## License

MIT
