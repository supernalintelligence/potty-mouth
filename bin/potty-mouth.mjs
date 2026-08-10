#!/usr/bin/env node
import { runHook } from '../src/hook.mjs';
import { install, uninstall } from '../src/install.mjs';
import { loadWords, loadUserWords, addWord, removeWord, REMOVED } from '../src/words.mjs';
import { detect, cleanText } from '../src/match.mjs';
import { cleanPath } from '../src/clean.mjs';

const [, , cmd, ...args] = process.argv;

function printHelp() {
  console.log(`potty-mouth — won't respond until you ask nicely

Usage:
  potty-mouth install              wire the hook into ~/.claude/settings.json
  potty-mouth uninstall            remove it
  potty-mouth hook                 (internal) run as the UserPromptSubmit hook
  potty-mouth check "<text>"       test a string against the table
  potty-mouth add <word> [swap]    add a word to your table (default: [removed])
  potty-mouth remove <word>        remove a word from your table
  potty-mouth list                 show the full active table (seed + yours)
  potty-mouth clean <path>         clean up a file or directory afterward
    --dry-run                      report only, write nothing
    --backup                       write <file>.bak before modifying
    --ext <suffix>                 only touch files ending in <suffix> (dir mode)
`);
}

async function main() {
  switch (cmd) {
    case 'hook':
      return runHook();

    case 'install': {
      const r = install();
      console.log(r.changed ? `Installed. Wired into ${r.path}` : `Already installed in ${r.path}`);
      return;
    }

    case 'uninstall': {
      const r = uninstall();
      console.log(r.changed ? `Removed from ${r.path}` : `Nothing to remove in ${r.path}`);
      return;
    }

    case 'check': {
      const text = args.join(' ');
      if (!text) { console.error('Usage: potty-mouth check "<text>"'); process.exit(2); }
      const words = loadWords();
      const hit = detect(text, words);
      console.log(hit ? 'BLOCKED — would refuse this prompt.' : 'clean — would pass through.');
      if (hit) {
        const { changed, text: cleaned } = cleanText(text, words, REMOVED);
        console.log(changed
          ? `cleaned version: ${cleaned}`
          : 'flagged by fuzzy/obfuscation match — no safe swap applied (avoids mangling an ambiguous match).');
      }
      return;
    }

    case 'add': {
      const [word, ...rest] = args;
      if (!word) { console.error('Usage: potty-mouth add <word> [swap]'); process.exit(2); }
      const swap = rest.join(' ') || undefined;
      addWord(word, swap);
      console.log(`Added "${word}" -> "${swap ?? REMOVED}"`);
      return;
    }

    case 'remove': {
      const [word] = args;
      if (!word) { console.error('Usage: potty-mouth remove <word>'); process.exit(2); }
      removeWord(word);
      console.log(`Removed "${word}" from your table (seed table entry, if any, still applies).`);
      return;
    }

    case 'list': {
      const userWords = loadUserWords();
      const words = loadWords();
      console.log(`${Object.keys(words).length} total (${Object.keys(userWords).length} yours):\n`);
      for (const [word, swap] of Object.entries(words)) {
        const mine = userWords[word] !== undefined ? ' *' : '';
        console.log(`  ${word} -> ${swap}${mine}`);
      }
      return;
    }

    case 'clean': {
      const target = args.find((a) => !a.startsWith('--'));
      if (!target) { console.error('Usage: potty-mouth clean <path> [--dry-run] [--backup] [--ext <suffix>]'); process.exit(2); }
      const opts = {
        dryRun: args.includes('--dry-run'),
        backup: args.includes('--backup'),
        ext: args.includes('--ext') ? args[args.indexOf('--ext') + 1] : undefined,
      };
      const results = cleanPath(target, opts);
      const changed = results.filter((r) => r.changed);
      console.log(`Scanned ${results.length} file(s), ${changed.length} modified${opts.dryRun ? ' (dry run)' : ''}.`);
      for (const r of changed) console.log(`  ${r.file} (${r.swaps} swap${r.swaps === 1 ? '' : 's'})`);
      return;
    }

    default:
      printHelp();
      if (cmd && cmd !== 'help' && cmd !== '--help' && cmd !== '-h') process.exit(2);
  }
}

main();
