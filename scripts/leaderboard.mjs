#!/usr/bin/env node
// Regenerates LEADERBOARD.md from runs/*/metrics.json. Run after every `node run.mjs` you intend
// to publish: `node scripts/leaderboard.mjs`. Zero npm dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const RUNS_DIR = path.join(REPO_ROOT, 'runs');
const LEADERBOARD_PATH = path.join(REPO_ROOT, 'LEADERBOARD.md');

const RUN_COMMAND = 'node run.mjs --api https://exhibitb.autofract.com --token $INTERNAL_TOKEN --budget-usd 1.50';

function pct(x) {
  return `${(x * 100).toFixed(1)}%`;
}

/** Reads every runs/<date>/metrics.json, sorted oldest to newest by run date. */
export function loadRuns(runsDir) {
  if (!fs.existsSync(runsDir)) return [];
  const runs = [];
  for (const entry of fs.readdirSync(runsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const metricsPath = path.join(runsDir, entry.name, 'metrics.json');
    if (!fs.existsSync(metricsPath)) continue;
    try {
      const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
      runs.push({ dir: entry.name, metrics });
    } catch {
      // A metrics.json that fails to parse is skipped rather than aborting the whole rebuild —
      // one corrupt run directory shouldn't take down the leaderboard for every other run.
      process.stderr.write(`skipping ${metricsPath}: not valid JSON\n`);
    }
  }
  runs.sort((a, b) => (a.metrics.date < b.metrics.date ? -1 : a.metrics.date > b.metrics.date ? 1 : a.dir < b.dir ? -1 : 1));
  return runs;
}

function renderTable(runs) {
  const header = '| Date | n | Balanced accuracy | EXISTS P/R | SAYS match | INSUFFICIENT share | Partial |';
  const sep = '|---|---|---|---|---|---|---|';
  const rows = runs.map(({ metrics: m }) => {
    const existsPR = `${m.exists.precision} / ${m.exists.recall}`;
    return `| ${m.date} | ${m.n} | ${m.balanced_accuracy} | ${existsPR} | ${m.says.match_rate} | ${pct(m.insufficient_share)} | ${m.partial ? 'yes' : 'no'} |`;
  });
  return [header, sep, ...rows].join('\n');
}

export function renderLeaderboard(runs) {
  const body =
    runs.length === 0
      ? 'No runs yet. Run the benchmark yourself (see below) to add the first row.'
      : renderTable(runs);

  return `# LEADERBOARD

Dated runs of \`run.mjs\` against citations-in-the-wild, scored per [\`lib/score.mjs\`](lib/score.mjs).
This table lists **our own runs only** — see [\`README.md\`](README.md) for what each column means
and why we don't accept third-party-submitted numbers.

${body}

## Run it yourself

\`\`\`sh
${RUN_COMMAND}
node scripts/leaderboard.mjs
\`\`\`

This regenerates this file from every \`runs/<date>/metrics.json\` on disk. We publish our own
numbers only: there is no submission process, and a PR that only edits this table's rows without
an accompanying \`runs/<date>/\` directory (results.jsonl + metrics.json + receipts/) will be
rejected. Anyone can reproduce a listed row by re-running the command above against the same
benchmark version and comparing \`metrics.json\`.
`;
}

function main() {
  const runs = loadRuns(RUNS_DIR);
  fs.writeFileSync(LEADERBOARD_PATH, renderLeaderboard(runs));
  console.log(`LEADERBOARD.md regenerated from ${runs.length} run(s) in ${path.relative(REPO_ROOT, RUNS_DIR)}/`);
}

const isMain = path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url);
if (isMain) main();
