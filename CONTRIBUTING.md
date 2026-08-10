# Contributing

Thanks for considering it. potty-mouth is small and zero-dependency on purpose — the bar for
a change is "does this make the filter more correct, more honest about its limits, or genuinely
funnier," not "does this add a feature."

## Setup

```
git clone https://github.com/supernalintelligence/potty-mouth.git
cd potty-mouth
npm test
```

No build step, no dependencies to install. `npm test` runs the full suite (`node --test`, no
framework).

## Before opening a PR

- **New behavior needs a test.** Every fix in this repo's history shipped with a regression
  test in the same commit — see `tests/` for the pattern (`match.test.mjs` for pure matcher
  logic, `hook.test.mjs`/`multi-target-hook.test.mjs` for the full per-target pipeline,
  `killswitch.test.mjs`, `installers.test.mjs`, `adapters.test.mjs`, `clean.test.mjs`).
- **Adding a word to the seed table?** Check it against the false-positive classes already
  fixed here: does it collide with a common word as a bare prefix (`ass` inside `associated`,
  `cock` inside `cockpit` — see the comments in `src/words.mjs` and `src/match.mjs` for the
  exact history)? If you're adding it to `SEED_FUZZY_ROOTS` (obfuscation-tolerant matching,
  not just the strict table), that bar is higher — see the header comment in `src/match.mjs`.
- **Adding a fourth target** (a new AI coding tool with its own prompt-submit hook)? You
  shouldn't need to touch `src/engine.mjs` at all — add a new file under `src/adapters/`
  (`parseInput`/`serializeDecision`) and, if the config shape differs from Claude Code's,
  a new file under `src/installers/`. If the target's hook contract turns out to be identical
  to an existing one, reuse that adapter directly (see `src/adapters/codex.mjs`) rather than
  duplicating it.
- **Run `npm test` and make sure it's still green.** No CI is wired up yet — this is the only
  gate.

## Reporting a false positive or false negative

Open an issue with the exact input (`potty-mouth check "..."` output if you can) and which
behavior you expected. False positives — a clean phrase getting blocked — are the highest
priority; two of the three found in production so far turned out to be missing word-boundary
anchoring, both fixed with a regression test the same day.

## What's out of scope

- New profanity-detection strategies (ML-based classification, LLM-in-the-loop scoring) — the
  whole point is that this stays a fast, local, zero-dependency regex lookup. If you want that,
  it's a different project.
- Telemetry, analytics, or anything phoning home. Never happening here.
