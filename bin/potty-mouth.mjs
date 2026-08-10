#!/usr/bin/env node
import { runHook } from '../src/hook.mjs';
import { install, uninstall } from '../src/install.mjs';
import { loadWords, loadUserWords, addWord, removeWord, REMOVED, SEED_FUZZY_ROOTS } from '../src/words.mjs';
import { detect, cleanText } from '../src/match.mjs';
import { cleanPath } from '../src/clean.mjs';
import { getStats, resetStats } from '../src/state.mjs';
import { isDisabled, getDisabledInfo, disable, enable } from '../src/killswitch.mjs';

const [, , cmd, ...args] = process.argv;

function printHelp() {
  console.log(`potty-mouth — won't respond until you ask nicely

Usage:
  potty-mouth install              wire the hook into ~/.claude/settings.json
  potty-mouth uninstall            remove it
  potty-mouth hook                 (internal) run as the UserPromptSubmit hook
  potty-mouth check "<text>"       test a string against the table
  potty-mouth add <word> [swap]    add a word to your table (default: [removed])
    --by ai                        tag the addition as AI-added (default: user)
    --force                        override the short-word/common-word safety guard
  potty-mouth remove <word>        remove a word from your table
  potty-mouth list                 show the full active table (seed + yours, tagged by who added it)
  potty-mouth stats                show block/bypass counts (total + per session)
  potty-mouth reset                zero out the counters (word table is untouched)
  potty-mouth clean <path>         clean up a file or directory afterward
    --dry-run                      report only, write nothing
    --backup                       write <file>.bak before modifying
    --ext <suffix>                 only touch files ending in <suffix> (dir mode)
  potty-mouth disable [reason]     kill switch — go fully inert + uninstall (word table untouched)
  potty-mouth enable               turn back on (re-run \`install\` if it was also uninstalled)
  potty-mouth status               show enabled/disabled state and why

  Type I_WANT_TO_SWEAR anywhere in a prompt to deliberately bypass the
  filter for that one prompt. Tracked separately from blocks — see
  \`potty-mouth stats\`. If a block is ever emitted despite this token being
  present, potty-mouth treats that as an unexplainable internal bug and
  automatically disables itself — see \`potty-mouth status\`.
`);
}

async function main() {
  switch (cmd) {
    case 'hook':
      return runHook();

    case 'install': {
      const r = install();
      console.log(r.changed ? `Installed. Wired into ${r.path}` : `Already installed in ${r.path}`);
      if (isDisabled()) console.log('Note: potty-mouth is currently DISABLED (see `potty-mouth status`) — run `potty-mouth enable` too, or it will stay inert despite being installed.');
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
      const hit = detect(text, words, SEED_FUZZY_ROOTS);
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
      const byIdx = args.indexOf('--by');
      const addedBy = byIdx !== -1 ? args[byIdx + 1] : 'user';
      const withoutBy = byIdx !== -1 ? [...args.slice(0, byIdx), ...args.slice(byIdx + 2)] : args;
      const force = withoutBy.includes('--force');
      const rest = withoutBy.filter((a) => a !== '--force');
      const [word, ...swapParts] = rest;
      if (!word) { console.error('Usage: potty-mouth add <word> [swap] [--by ai|user] [--force]'); process.exit(2); }
      if (addedBy !== 'user' && addedBy !== 'ai') { console.error('--by must be "user" or "ai"'); process.exit(2); }
      const swap = swapParts.join(' ') || undefined;
      try {
        addWord(word, swap, addedBy, { force });
      } catch (e) {
        console.error(e.message);
        process.exit(2);
      }
      console.log(`Added "${word}" -> "${swap ?? REMOVED}" (by ${addedBy})`);
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
      console.log(`${Object.keys(words).length} total (${Object.keys(userWords).length} added by you/AI):\n`);
      for (const [word, swap] of Object.entries(words)) {
        const meta = userWords[word];
        const tag = meta ? ` (${meta.addedBy})` : '';
        console.log(`  ${word} -> ${swap}${tag}`);
      }
      return;
    }

    case 'stats': {
      const stats = getStats();
      const sessionCount = Object.keys(stats.sessions).length;
      console.log(`Total blocks: ${stats.totalBlocks}, bypasses: ${stats.totalBypasses} — across ${sessionCount} session${sessionCount === 1 ? '' : 's'}.`);
      const recent = Object.entries(stats.sessions)
        .sort((a, b) => new Date(b[1].lastActivityAt) - new Date(a[1].lastActivityAt))
        .slice(0, 5);
      for (const [id, s] of recent) {
        console.log(`  ${id.slice(0, 8)}...  ${s.blocks} block${s.blocks === 1 ? '' : 's'}, ${s.bypasses ?? 0} bypass${(s.bypasses ?? 0) === 1 ? '' : 'es'}  last: ${s.lastActivityAt}`);
      }
      return;
    }

    case 'reset': {
      const before = resetStats();
      console.log(`Reset. Was at ${before.totalBlocks} block(s) and ${before.totalBypasses} bypass(es) across ${Object.keys(before.sessions).length} session(s). Word table untouched.`);
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

    case 'disable': {
      const reason = args.join(' ') || 'Manual — user ran `potty-mouth disable`.';
      disable(reason, { automatic: false });
      console.log('Disabled. The hook is now fully inert and has been uninstalled from settings.json.');
      console.log('The word table and counters are untouched. Run `potty-mouth enable` (then `install`) to turn it back on.');
      return;
    }

    case 'enable': {
      const was = getDisabledInfo();
      const cleared = enable();
      if (!was) { console.log('Was not disabled — nothing to do.'); return; }
      console.log(`Re-enabled${cleared ? '' : ' (flag was already clear)'}.`);
      console.log('If it was auto-uninstalled, run `potty-mouth install` to wire it back into settings.json.');
      return;
    }

    case 'status': {
      const disabled = isDisabled();
      if (!disabled) {
        console.log('Enabled — actively filtering.');
      } else {
        const info = getDisabledInfo();
        console.log('DISABLED' + (info?.automatic ? ' (automatic — potty-mouth disabled itself)' : ' (manual)') + '.');
        if (info?.disabledAt) console.log(`  since: ${info.disabledAt}`);
        if (info?.reason) console.log(`  reason: ${info.reason}`);
        if (info?.promptExcerpt) console.log(`  prompt excerpt (for a bug report): ${JSON.stringify(info.promptExcerpt)}`);
        if (info?.sessionId) console.log(`  session: ${info.sessionId}`);
        if (info?.automatic) {
          console.log('  This should never happen — please file a bug report if you see this.');
        }
      }
      return;
    }

    default:
      printHelp();
      if (cmd && cmd !== 'help' && cmd !== '--help' && cmd !== '-h') process.exit(2);
  }
}

main();
