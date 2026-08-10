// Thin per-invocation entry point — reads stdin, picks the target adapter,
// hands the normalized input to the ONE decision engine (engine.mjs), and
// writes back whatever that target's adapter serializes the Decision as.
// No detection/bypass/counter/kill-switch logic lives here; see engine.mjs.
import { getAdapter } from './adapters/index.mjs';
import { decide } from './engine.mjs';

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

// Entry point — deliberately never lets ANYTHING it does uncaught-crash the
// process. A crashed hook process is undefined behavior from whichever
// tool invoked it (unlike our own explicit block decision, which is a
// documented, understood outcome) — a permission error writing state, a
// corrupted words.json hitting some code path we didn't anticipate, an
// unknown --target, anything at all, must fail OPEN (silently let the
// prompt through) rather than risk interfering with a real conversation
// turn over our own bug.
export async function runHook(target) {
  try {
    await runHookInner(target);
  } catch {
    // Swallow anything unexpected -> fail open, no stdout, exit 0.
  }
  process.exit(0);
}

async function runHookInner(target) {
  const adapter = getAdapter(target); // throws on an unknown target -> caught above, fails open

  const raw = await readStdin();
  let normalized;
  try {
    normalized = adapter.parseInput(raw);
  } catch {
    return; // can't parse this target's payload -> fail open
  }

  const decision = decide(normalized);
  const out = adapter.serializeDecision(decision);
  if (out) process.stdout.write(out);
}
