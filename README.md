# potty-mouth

A [Claude Code](https://claude.com/claude-code) hook that won't respond until you ask nicely.

Say something with a swear word in it and the prompt never reaches the model — you get a
short refusal and have to try again. No alerts, no logging beyond a local word table, just
a lookup.

```
$ potty-mouth check "fix this fucking bug"
BLOCKED — would refuse this prompt.
cleaned version: fix this foxing bug
```

## Install

```
npm install -g potty-mouth
potty-mouth install
```

That wires a `UserPromptSubmit` hook into `~/.claude/settings.json`. Every prompt you submit
gets checked against the word table before Claude ever sees it. `potty-mouth uninstall`
removes it.

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
upgrading potty-mouth never clobbers what you added.

Matching is whole-word and case-preserving, with a strict `\b...\b` boundary (so "class" is
never touched for containing "ass" — no Scunthorpe problem), and it's obfuscation-tolerant
for the *block* decision — `f*ck`, `sh!t`, `f.u.c.k` all still trip the filter. It does **not**
blind-rewrite an obfuscated match in place, only a strict exact match — guessing at a fuzzy
match's intended spelling risks mangling the sentence.

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

Claude Code's `UserPromptSubmit` hook receives the prompt on stdin before the model sees
anything. `potty-mouth hook` (what `potty-mouth install` wires in) reads it, checks it against
the table, and if something matches, returns `{"decision": "block", "reason": "..."}` — the
prompt is discarded and you see the refusal instead. A clean prompt passes through untouched.

No network calls, no external service, no LLM in the loop for the block decision — just a
regex table lookup against a local file.

## License

MIT
