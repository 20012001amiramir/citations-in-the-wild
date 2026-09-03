#!/usr/bin/env node
// Wraps the weekly "+100 records" recipe documented in benchmark/README.md §6. It runs the
// automatic, deterministic steps of the pipeline (re-harvest, fetch, triage) and then stops and
// prints what a human needs to read and transcribe next — it makes NO model calls and transcribes
// nothing itself. Reading a court opinion and deciding whether it found a citation fabricated,
// misrepresented, or fine is a judgment call this script deliberately leaves to a person.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function findPython() {
  for (const cmd of ['python3', 'python']) {
    const probe = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
    if (probe.status === 0) return cmd;
  }
  throw new Error('No "python3" or "python" found on PATH. Install Python 3 and `pip install -r work/requirements.txt` first.');
}

function runStep(python, script, args = []) {
  console.log(`\n=== ${script}${args.length ? ' ' + args.join(' ') : ''} ===`);
  const result = spawnSync(python, [path.join('work', script), ...args], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${script} exited with code ${result.status}`);
  }
}

function main() {
  const python = findPython();
  console.log(`Using "${python}" (work/requirements.txt: requests, pymupdf — run \`pip install -r work/requirements.txt\` if a step below fails on import).`);

  // 1. Re-harvest: re-runs the 24 phrase queries against CourtListener, newest first, and merges
  //    into raw/candidates2.json. Resumable — safe to run repeatedly.
  runStep(python, 'harvest2.py');

  // 2. Fetch + extract: pulls each new opinion PDF and writes text to raw/txt/. Skips anything
  //    already extracted, so also safe to re-run.
  runStep(python, 'fetchdocs.py');

  // 3. Triage: ranks candidate decisions by how many distinct citation strings sit next to a
  //    finding phrase. This prints the ranking that step 4 below is read against.
  runStep(python, 'triage2.py');

  console.log(`
=== Next: read and transcribe (not automated — this is the judgment-call step) ===

Work strictly down the ranking printed above (highest count first). A decision scoring >= 10
typically yields 8-20 records; one scoring <= 4 usually yields none, per benchmark/README.md §6.

For each candidate cluster id "<cid>" from that ranking, run:

  ${python} work/win2.py <cid> 180 500

That prints only the passages containing both a finding phrase and a citation. Read them and, for
each individually-named offending citation:

  1. Transcribe it into a new work/records/NNN_<slug>.json, following the shape of the existing
     files in work/records/ (id, record_type, verdict_expected, checks_expected, finding,
     authority_type, cited_authority, offending_filing, court_finding, what_actually_exists,
     source_decision).
  2. Rule: if the court did not name the citation, do not create a record for it (see
     benchmark/README.md §5, limit 2 — aggregate/un-itemised findings are excluded, not fabricated
     records to fill a quota).
  3. Harvest 3-6 control citations per decision while you are there — real authorities the court
     itself relied on, preferring ones the court quotes (that exercises the SAYS check). This keeps
     the control ratio near 1:3.

Quality gates before merging the week's batch (benchmark/README.md §6):
  - Every record has a non-empty, verbatim court_finding.quote and a navigable locator.
  - verdict_expected is EXISTS_FAIL only where the court said the authority/citation does not
    resolve, not merely that it was unhelpful.
  - No two records share the same (as_cited, quoted_text-or-cited_for, source_decision.case_name)
    triple.
  - Control ratio stays between 1:2 and 1:4 against offending records.

When the new work/records/*.json files are ready, rebuild the benchmark:

  ${python} work/finalize.py

That regenerates benchmark/citations-in-the-wild.v0.json and prints the new counts. Bump
"version" in the output if the record count changed materially, then commit.
`);
}

main();
