// node:test suite for the whole Node side of Citations in the Wild: the pure scoring module
// (lib/score.mjs) and the runner (../run.mjs). One file, per the repo layout — see README.md.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

import { mapVerdict, declaredChecks, scoreResult, computeMetrics, isAggregateRecord, dropAggregates, dropUnscoreable, declaresOnlyExistsSays } from './score.mjs';
import { resolveDatasetPath } from './dataset.mjs';
import { run, postBatchWithRetry, realVerify, NonRetryableError, toClaim, contextOf, CONTEXT_MAX, BATCH_SIZE } from '../run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

describe('mapVerdict — every EXISTS/SAYS verdict against every set of declared checks', () => {
  // [existsVerdict, saysVerdict, checksExpected, want]
  //
  // The third column is the record's own `checks_expected` — what its material can be scored on.
  // Every combination of the three declared sets in the dataset (["EXISTS"], ["EXISTS","SAYS"],
  // ["EXISTS","HOLDS"]) against every EXISTS and SAYS verdict the API returns.
  const SAYS_ONLY = ['EXISTS', 'SAYS'];
  const EXISTS_ONLY = ['EXISTS'];
  const HOLDS = ['EXISTS', 'HOLDS'];

  const cases = [
    // --- EXISTS never resolved: the rest of the record's checks are moot either way.
    ['SOURCE_UNREACHABLE', null, EXISTS_ONLY, 'INSUFFICIENT'],
    ['SOURCE_UNREACHABLE', null, SAYS_ONLY, 'INSUFFICIENT'],
    ['SOURCE_UNREACHABLE', 'NOT_RUN', HOLDS, 'INSUFFICIENT'],
    ['UNSUPPORTED_LOCATOR', 'MATCH', SAYS_ONLY, 'INSUFFICIENT'], // says is irrelevant once EXISTS is insufficient
    ['UNSUPPORTED_LOCATOR', 'MATCH', EXISTS_ONLY, 'INSUFFICIENT'],
    ['SOME_FUTURE_VERDICT', 'MATCH', EXISTS_ONLY, 'INSUFFICIENT'], // defensive: unknown EXISTS verdict
    ['SOME_FUTURE_VERDICT', 'MATCH', SAYS_ONLY, 'INSUFFICIENT'],

    // --- EXISTS failed outright: an EXISTS_FAIL whatever else the record declared.
    ['NOT_FOUND', null, EXISTS_ONLY, 'EXISTS_FAIL'],
    ['NOT_FOUND', 'MATCH', SAYS_ONLY, 'EXISTS_FAIL'], // says is irrelevant once EXISTS has failed outright
    ['NOT_FOUND', 'NOT_RUN', HOLDS, 'EXISTS_FAIL'],

    // --- The authority resolved, and the record declares SAYS: the SAYS verdict decides.
    ['RESOLVED', 'NOT_FOUND', SAYS_ONLY, 'SAYS_FAIL'],
    ['RESOLVED_NO_ACCESS', 'DRIFT', SAYS_ONLY, 'SAYS_FAIL'],
    ['RESOLVED', 'MATCH', SAYS_ONLY, 'PASS'],
    ['RESOLVED_NO_ACCESS', 'MATCH', SAYS_ONLY, 'PASS'],
    ['RESOLVED', 'NOT_RUN', SAYS_ONLY, 'INSUFFICIENT'], // a quote was on the record, but SAYS never ran on it
    ['RESOLVED_NO_ACCESS', 'NOT_RUN', SAYS_ONLY, 'INSUFFICIENT'],
    ['RESOLVED', 'SOME_FUTURE_VERDICT', SAYS_ONLY, 'INSUFFICIENT'], // defensive: unknown SAYS verdict

    // --- The authority resolved, and EXISTS is all the record declares: a resolve is the answer.
    ['RESOLVED', 'NOT_RUN', EXISTS_ONLY, 'PASS'], // the case v0.1 could not score: nothing was asked of SAYS
    ['RESOLVED_NO_ACCESS', 'NOT_RUN', EXISTS_ONLY, 'PASS'],
    ['RESOLVED', null, EXISTS_ONLY, 'PASS'],
    ['RESOLVED', 'MATCH', EXISTS_ONLY, 'PASS'],
    // A verdict on a check the record never declared changes nothing: with no quote on the record
    // there is nothing for SAYS to have compared, so whatever it reports is not this record's answer.
    ['RESOLVED', 'NOT_FOUND', EXISTS_ONLY, 'PASS'],
    ['RESOLVED', 'DRIFT', EXISTS_ONLY, 'PASS'],

    // --- The authority resolved, and the record declares HOLDS: this run cannot make that check.
    ['RESOLVED', 'NOT_RUN', HOLDS, 'INSUFFICIENT'],
    ['RESOLVED_NO_ACCESS', 'NOT_RUN', HOLDS, 'INSUFFICIENT'],
    ['RESOLVED', 'MATCH', HOLDS, 'INSUFFICIENT'], // a MATCH on an undeclared check is not a pass on HOLDS
    ['RESOLVED', 'NOT_FOUND', HOLDS, 'INSUFFICIENT'],
  ];
  assert.equal(cases.length, 27, 'fixture must have exactly 27 rows');

  for (const [exists, says, checks, want] of cases) {
    test(`EXISTS=${exists} SAYS=${says} checks=[${checks}] -> ${want}`, () => {
      assert.equal(mapVerdict(exists, says, checks), want);
    });
  }
});

describe('mapVerdict — records written before checks_expected named its checks', () => {
  // v0 and v0.1 declared EXISTS and SAYS on every record, as an object of per-check outcomes;
  // older callers passed the `hasQuote` boolean in the same position. Both must go on scoring
  // exactly as they did — which is what declaredChecks reads them back as.
  const legacyShapes = [
    ['v0/v0.1 object', { EXISTS: 'PASS', SAYS: 'FAIL' }],
    ['v0/v0.1 object, EXISTS_FAIL record', { EXISTS: 'FAIL', SAYS: 'NOT_REACHED' }],
    ['a caller passing hasQuote=true', true],
    ['a caller passing hasQuote=false', false],
    ['a caller passing nothing at all', undefined],
    ['a record with checks_expected: null', null],
  ];

  for (const [label, shape] of legacyShapes) {
    test(`${label} scores as EXISTS + SAYS`, () => {
      assert.deepEqual(declaredChecks(shape), ['EXISTS', 'SAYS']);
      assert.equal(mapVerdict('RESOLVED', 'NOT_RUN', shape), 'INSUFFICIENT');
      assert.equal(mapVerdict('RESOLVED', 'MATCH', shape), 'PASS');
      assert.equal(mapVerdict('RESOLVED', 'DRIFT', shape), 'SAYS_FAIL');
      assert.equal(mapVerdict('NOT_FOUND', null, shape), 'EXISTS_FAIL');
    });
  }

  test('declaredChecks passes a v0.2 array straight through', () => {
    assert.deepEqual(declaredChecks(['EXISTS']), ['EXISTS']);
    assert.deepEqual(declaredChecks(['EXISTS', 'HOLDS']), ['EXISTS', 'HOLDS']);
  });
});

describe('scoreResult — the gold label decides only whether the prediction was right', () => {
  test('a control with no quote is now scored PASS on a resolve, and counted correct', () => {
    assert.deepEqual(scoreResult('PASS', 'RESOLVED', 'NOT_RUN', ['EXISTS']), { predicted: 'PASS', correct: true });
  });

  test('the same verdicts on a record that did ask for SAYS stay insufficient', () => {
    assert.deepEqual(scoreResult('PASS', 'RESOLVED', 'NOT_RUN', ['EXISTS', 'SAYS']), {
      predicted: 'INSUFFICIENT',
      correct: false,
    });
  });

  test('an EXISTS_FAIL record that resolved is a wrong answer, not an absent one', () => {
    assert.deepEqual(scoreResult('EXISTS_FAIL', 'RESOLVED', 'NOT_RUN', ['EXISTS']), {
      predicted: 'PASS',
      correct: false,
    });
  });
});

describe('toClaim — the claim the API is sent, with the words around the citation', () => {
  const cited = (over) => ({ as_cited: 'Eduardo v. Garland, 28 F.4th 742 (9th Cir. 2022)', case_name: 'Eduardo v. Garland', reporter_citation: '28 F.4th 742', court_year: '9th Cir. 2022', quoted_text: null, cited_for: null, ...over });

  test('locator, quote, claim and context from one record', () => {
    const claim = toClaim({ id: 'CITW-0001', cited_authority: cited({ quoted_text: 'the words', cited_for: 'a proposition' }) });
    assert.deepEqual(claim, {
      id: 'CITW-0001',
      locator: { type: 'case', value: 'Eduardo v. Garland, 28 F.4th 742 (9th Cir. 2022)' },
      quote: 'the words',
      claim: 'a proposition',
      context: 'Eduardo v. Garland, 28 F.4th 742 (9th Cir. 2022)',
    });
  });

  test('context is as_cited whenever it carries a caption, and the name is prefixed only to a bare citation', () => {
    assert.equal(contextOf(cited()), 'Eduardo v. Garland, 28 F.4th 742 (9th Cir. 2022)');
    // The caption in another spelling than the record's own: sent once, as the filing printed it.
    // Printed twice, the parties read back out of it were `Connecticut Mut. Life Ins. Co., Kelly`.
    assert.equal(contextOf(cited({ as_cited: 'Kelly v. Conn. Mut. Life Ins. Co., 628 So. 2d 454 (Ala. 1993)', case_name: 'Kelly v. Connecticut Mut. Life Ins. Co.' })), 'Kelly v. Conn. Mut. Life Ins. Co., 628 So. 2d 454 (Ala. 1993)');
    assert.equal(contextOf(cited({ case_name: null })), 'Eduardo v. Garland, 28 F.4th 742 (9th Cir. 2022)');
    // A citation printed bare has no parties of its own, and the record's name is what supplies them.
    assert.equal(contextOf(cited({ as_cited: '628 So. 2d 454 (Ala. 1993)', case_name: 'Kelly v. Connecticut Mut. Life Ins. Co.' })), 'Kelly v. Connecticut Mut. Life Ins. Co., 628 So. 2d 454 (Ala. 1993)');
    assert.equal(contextOf(cited({ as_cited: '[2020] EWCA Civ 1442', case_name: 'R v. Smith' })), 'R v. Smith, [2020] EWCA Civ 1442');
    // Across the dataset: no record whose `as_cited` opens with a caption gets a name in front of
    // it, so no context doubles the caption the filing printed.
    for (const record of dropUnscoreable(JSON.parse(fs.readFileSync(resolveDatasetPath(REPO_ROOT), 'utf8')).records)) {
      const authority = record.cited_authority;
      const as = String(authority.as_cited ?? '').trim();
      if (authority.surrounding_text || /^[\d[(]/.test(as)) continue;
      assert.equal(contextOf(authority), as.slice(0, CONTEXT_MAX), record.id);
    }
  });

  test("a record's own surrounding text wins, and the context never exceeds the API's cap", () => {
    assert.equal(contextOf(cited({ surrounding_text: ' See Eduardo v. Garland, 28 F.4th 742 (9th Cir. 2022). ' })), 'See Eduardo v. Garland, 28 F.4th 742 (9th Cir. 2022).');
    const long = contextOf(cited({ surrounding_text: 'x'.repeat(CONTEXT_MAX + 50) }));
    assert.equal(long.length, CONTEXT_MAX);
    assert.equal(contextOf(cited({ as_cited: '628 So. 2d 454', case_name: 'N'.repeat(CONTEXT_MAX) })).length, CONTEXT_MAX);
  });

  test('every scoreable record of the current dataset yields a context within the cap', () => {
    const data = JSON.parse(fs.readFileSync(resolveDatasetPath(REPO_ROOT), 'utf8'));
    for (const record of dropUnscoreable(data.records)) {
      const { context } = toClaim(record);
      assert.ok(typeof context === 'string' && context.length > 0 && context.length <= CONTEXT_MAX, record.id);
      assert.ok(context.includes(record.cited_authority.reporter_citation ?? record.cited_authority.as_cited) || context.includes(record.cited_authority.as_cited), record.id);
    }
  });
});

describe('computeMetrics', () => {
  test('matches hand-computed precision/recall/F1/balanced-accuracy on a 10-record set', () => {
    const records = [
      { expected: 'EXISTS_FAIL', predicted: 'EXISTS_FAIL' },
      { expected: 'EXISTS_FAIL', predicted: 'EXISTS_FAIL' },
      { expected: 'EXISTS_FAIL', predicted: 'SAYS_FAIL' },
      { expected: 'SAYS_FAIL', predicted: 'SAYS_FAIL' },
      { expected: 'SAYS_FAIL', predicted: 'SAYS_FAIL' },
      { expected: 'SAYS_FAIL', predicted: 'PASS' },
      { expected: 'PASS', predicted: 'PASS' },
      { expected: 'PASS', predicted: 'PASS' },
      { expected: 'PASS', predicted: 'INSUFFICIENT' },
      { expected: 'EXISTS_FAIL', predicted: 'INSUFFICIENT' },
    ];
    const metrics = computeMetrics(records, {
      date: '2026-09-03',
      partial: true,
      costUsd: 2.5,
      engine: 'test-engine-v1',
    });
    assert.deepEqual(metrics, {
      date: '2026-09-03',
      n: 10,
      n_scored: 8,
      n_insufficient: 2,
      insufficient_share: 0.2,
      partial: true,
      cost_usd: 2.5,
      exists: { precision: 1, recall: 0.5 },
      says: { match_rate: 0.667 },
      balanced_accuracy: 0.778,
      per_class: {
        EXISTS_FAIL: { p: 1, r: 0.667, f1: 0.8 },
        SAYS_FAIL: { p: 0.667, r: 0.667, f1: 0.667 },
        PASS: { p: 0.667, r: 1, f1: 0.8 },
      },
      engine: 'test-engine-v1',
    });
  });

  test('ERROR predictions are folded into insufficient_share like INSUFFICIENT', () => {
    const records = [
      { expected: 'PASS', predicted: 'PASS' },
      { expected: 'PASS', predicted: 'ERROR' },
    ];
    const metrics = computeMetrics(records, { date: '2026-09-03', partial: false, costUsd: 0 });
    assert.equal(metrics.n, 2);
    assert.equal(metrics.n_scored, 1);
    assert.equal(metrics.n_insufficient, 1);
    assert.equal(metrics.insufficient_share, 0.5);
    assert.equal('engine' in metrics, false, 'engine key omitted when not supplied');
  });

  test('empty run does not divide by zero', () => {
    const metrics = computeMetrics([], { date: '2026-09-03', partial: false, costUsd: 0 });
    assert.equal(metrics.n, 0);
    assert.equal(metrics.insufficient_share, 0);
    assert.equal(metrics.says.match_rate, 0);
    assert.equal(metrics.balanced_accuracy, 0);
  });
});

describe('aggregate-record exclusion', () => {
  test('flags a record whose as_cited is tagged [Aggregate finding], case-insensitively', () => {
    assert.equal(isAggregateRecord({ cited_authority: { as_cited: '[Aggregate finding] eighteen of forty-five citations' } }), true);
    assert.equal(isAggregateRecord({ cited_authority: { as_cited: '[aggregate finding] lower-cased tag' } }), true);
  });

  test('does not flag a normal citation that merely starts with a bracket', () => {
    // CITW-0140 in v0: a real, single, fully-itemised citation that just lacks a case *name*.
    assert.equal(
      isAggregateRecord({ cited_authority: { as_cited: '[unnamed Pennsylvania Superior Court case], 217 A.3d 845 (Pa. Super. Ct. 2019)' } }),
      false,
    );
  });

  test('does not flag a normal citation', () => {
    assert.equal(isAggregateRecord({ cited_authority: { as_cited: 'Eduardo v. Garland, 28 F.4th 742 (9th Cir. 2022)' } }), false);
  });

  test('the current dataset drops 6 records for having no citation of their own, and 22 more for declaring HOLDS', () => {
    const benchmarkPath = resolveDatasetPath(REPO_ROOT);
    assert.equal(path.basename(benchmarkPath), 'citations-in-the-wild.v0.2.json');
    const data = JSON.parse(fs.readFileSync(benchmarkPath, 'utf8'));
    assert.equal(data.records.length, 225);

    const noCitation = data.records.filter((r) => r.citation_completeness !== 'full');
    assert.deepEqual(
      noCitation.map((r) => r.id).sort(),
      ['CITW-0183', 'CITW-0184', 'CITW-0205', 'CITW-0216', 'CITW-0224', 'CITW-0225'],
    );
    assert.deepEqual(
      noCitation.map((r) => r.citation_completeness).sort(),
      ['aggregate', 'aggregate', 'aggregate', 'aggregate', 'partial', 'partial'],
    );
    assert.equal(data.records.length - noCitation.length, data.counts.scoreable_per_citation);

    const kept = dropUnscoreable(data.records);
    const dropped = data.records.filter((r) => !kept.includes(r));
    // The 6 above, plus the 22 `full` records whose only remaining check is HOLDS.
    assert.equal(dropped.length, 28);
    assert.equal(
      dropped.filter((r) => r.citation_completeness === 'full' && r.checks_expected.includes('HOLDS')).length,
      22,
    );
    assert.ok(dropped.every((r) => r.citation_completeness !== 'full' || r.checks_expected.includes('HOLDS')));
    assert.equal(kept.length, 197);
    assert.equal(kept.length, data.counts.scoreable_exists_says);
    assert.ok(kept.every((r) => r.checks_expected.every((c) => c === 'EXISTS' || c === 'SAYS')));
    // CITW-0140 (the once-unnamed but itemised case) must survive.
    assert.ok(kept.some((r) => r.id === 'CITW-0140'));
  });

  test('declaresOnlyExistsSays partitions the dataset the way checks_expected does', () => {
    const data = JSON.parse(fs.readFileSync(resolveDatasetPath(REPO_ROOT), 'utf8'));
    const byGroup = {};
    for (const r of data.records) {
      const key = r.checks_expected.join('+');
      byGroup[key] = (byGroup[key] ?? 0) + 1;
      assert.equal(declaresOnlyExistsSays(r), !r.checks_expected.includes('HOLDS'), r.id);
    }
    assert.deepEqual(byGroup, data.counts.by_declared_checks);
    assert.deepEqual(byGroup, { EXISTS: 125, 'EXISTS+SAYS': 76, 'EXISTS+HOLDS': 24 });
    // A record with no checks_expected at all is a v0-shaped one, and asked for EXISTS and SAYS.
    assert.equal(declaresOnlyExistsSays({}), true);
  });

  test('dropAggregates keeps working on v0-shaped records (no completeness field)', () => {
    const v0 = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'benchmark', 'citations-in-the-wild.v0.json'), 'utf8'));
    assert.equal(v0.records.length, 223);
    assert.equal(dropAggregates(v0.records).length, 219);
  });

  test('resolveDatasetPath picks the highest version, not the lexically last name', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'citw-dataset-'));
    try {
      fs.mkdirSync(path.join(root, 'benchmark'));
      for (const v of ['v0', 'v0.10', 'v0.2', 'v1']) fs.writeFileSync(path.join(root, 'benchmark', `citations-in-the-wild.${v}.json`), '{}');
      assert.equal(path.basename(resolveDatasetPath(root)), 'citations-in-the-wild.v1.json');
      fs.unlinkSync(path.join(root, 'benchmark', 'citations-in-the-wild.v1.json'));
      assert.equal(path.basename(resolveDatasetPath(root)), 'citations-in-the-wild.v0.10.json');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('run.mjs --mock (end-to-end, no network)', () => {
  const RUN_MJS = path.join(REPO_ROOT, 'run.mjs');

  function runMock(extraArgs, outDir) {
    return execFileSync('node', [RUN_MJS, '--mock', '--out', outDir, ...extraArgs], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
  }

  function withTempDir(fn) {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'citw-mock-'));
    try {
      fn(outDir);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }

  test('writes results.jsonl, metrics.json and receipts/, and prints a 6-line summary', () => {
    withTempDir((outDir) => {
      const stdout = runMock(['--limit', '30'], outDir);
      assert.equal(stdout.trim().split('\n').length, 6, 'summary must be exactly 6 lines');

      const resultsPath = path.join(outDir, 'results.jsonl');
      const metricsPath = path.join(outDir, 'metrics.json');
      assert.ok(fs.existsSync(resultsPath));
      assert.ok(fs.existsSync(metricsPath));

      const lines = fs.readFileSync(resultsPath, 'utf8').trim().split('\n');
      assert.equal(lines.length, 30);
      for (const line of lines) {
        const row = JSON.parse(line);
        assert.match(row.id, /^CITW-\d{4}$/);
        assert.ok(['EXISTS_FAIL', 'SAYS_FAIL', 'PASS'].includes(row.expected));
        assert.ok(['EXISTS_FAIL', 'SAYS_FAIL', 'PASS', 'INSUFFICIENT', 'ERROR'].includes(row.predicted));
        assert.equal(typeof row.correct, 'boolean');
      }

      const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
      assert.equal(metrics.n, 30);
      assert.equal(metrics.partial, false);
      assert.equal(metrics.engine, 'mock-v0');
      assert.ok(metrics.cost_usd > 0);
      for (const key of [
        'date', 'n', 'n_scored', 'n_insufficient', 'insufficient_share',
        'partial', 'cost_usd', 'exists', 'says', 'balanced_accuracy', 'per_class',
      ]) {
        assert.ok(key in metrics, `metrics.json missing key ${key}`);
      }

      const receiptsDir = path.join(outDir, 'receipts');
      assert.ok(fs.readdirSync(receiptsDir).length > 0, 'expected at least one receipt file');
    });
  });

  test('batches only what this run can score (225 total -> 197 available)', () => {
    withTempDir((outDir) => {
      runMock([], outDir); // no --limit: everything an EXISTS/SAYS run can answer
      const metrics = JSON.parse(fs.readFileSync(path.join(outDir, 'metrics.json'), 'utf8'));
      assert.equal(metrics.n, 197);
    });
  });

  test('budget stop: cuts the run short and marks partial:true once cost exceeds --budget-usd', () => {
    withTempDir((outDir) => {
      // --mock costs a fixed $0.01 a record, so a batch costs BATCH_SIZE cents. The run stops after
      // the first batch whose cumulative cost crosses the budget, and only while records remain.
      //
      // The expectation walks that rule rather than solving it. `ceil(budget / batchCost)` is the
      // same number only when the budget is not a whole multiple of the batch's cost — at ten a
      // batch it agreed by way of a floating-point rounding error, and at two it was one batch
      // short. A rule this test exists to check is not one it should restate in different terms.
      const budget = 0.3;
      const batchCost = BATCH_SIZE * 0.01;
      let cost = 0;
      let batches = 0;
      while (cost <= budget) {
        cost += batchCost;
        batches += 1;
      }
      const scored = batches * BATCH_SIZE;
      runMock(['--limit', '60', '--budget-usd', String(budget)], outDir);
      const metrics = JSON.parse(fs.readFileSync(path.join(outDir, 'metrics.json'), 'utf8'));
      assert.equal(metrics.partial, true);
      assert.equal(metrics.n, scored);
      assert.equal(metrics.cost_usd, Number((scored * 0.01).toFixed(2)));

      const lines = fs.readFileSync(path.join(outDir, 'results.jsonl'), 'utf8').trim().split('\n');
      assert.equal(lines.length, scored);
    });
  });

  test('a budget large enough to cover the whole run is not partial', () => {
    withTempDir((outDir) => {
      runMock(['--limit', '60', '--budget-usd', '10'], outDir);
      const metrics = JSON.parse(fs.readFileSync(path.join(outDir, 'metrics.json'), 'utf8'));
      assert.equal(metrics.partial, false);
      assert.equal(metrics.n, 60);
    });
  });

  test('--api/--token are required when --mock is not set', () => {
    assert.throws(() => execFileSync('node', [RUN_MJS], { cwd: REPO_ROOT, encoding: 'utf8', stdio: 'pipe' }));
  });
});

describe('run.mjs against a fake real API (in-process http.Server, no child process)', () => {
  // A plain http.Server bound to 127.0.0.1 on a random port, created fresh per test and closed in
  // a finally. Stands in for EXHIBIT B's /api/internal/verify. Deliberately NOT spawned via
  // execFileSync/child_process: an earlier version of this suite spawned `node run.mjs` as a
  // child process pointed at a server in the parent test process, and that hung indefinitely in
  // this sandbox (a child process here cannot reach a loopback listener owned by its parent) —
  // see the R2 build report. Calling the exported functions (`run`, `postBatchWithRetry`,
  // `realVerify`) directly, in-process, avoids that entirely and is faster besides.
  //
  // Backoff is injected via `sleepFn`/`backoffMs` (see postBatchWithRetry's `options` param in
  // run.mjs) so every retry in these tests resolves in milliseconds instead of real backoff time.
  const FAST_RETRY = { sleepFn: () => Promise.resolve(), backoffMs: 1 };

  function startFakeApi(handler) {
    return new Promise((resolve) => {
      const server = http.createServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        let body = null;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          body = null;
        }
        handler(body, res);
      });
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        resolve({ server, api: `http://127.0.0.1:${port}` });
      });
    });
  }

  async function withTempDir(fn) {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'citw-real-'));
    try {
      await fn(outDir);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  }

  function fakeSuccessResponse(claims, receiptId) {
    return {
      results: claims.map((c) => ({ id: c.id, exists: { verdict: 'RESOLVED' }, says: { verdict: 'NOT_RUN' }, cost_usd: 0.01 })),
      receipt: { id: receiptId, self_hash: 'h', seq: 1 },
      cost_usd: 0.01 * claims.length,
      engine: 'fake-real-api',
    };
  }

  test('(a) first attempt 503, second attempt 200: results recorded and a receipt is written', async () => {
    let attempts = 0;
    const { server, api } = await startFakeApi((body, res) => {
      attempts += 1;
      if (attempts === 1) {
        res.writeHead(503);
        res.end('temporarily unavailable');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fakeSuccessResponse(body.claims, 'receipt-503-then-200')));
    });
    try {
      await withTempDir(async (outDir) => {
        const metrics = await run({ api, token: 't', limit: 5, budgetUsd: Infinity, mock: false, out: outDir }, FAST_RETRY);
        // One request per batch, plus the one retry the 503 bought. Derived from BATCH_SIZE rather
        // than written down: this assertion said 2 while five records happened to be one batch, and
        // it failed the day the batch got smaller — for a reason that had nothing to do with retries.
        const batches = Math.ceil(5 / BATCH_SIZE);
        assert.equal(attempts, batches + 1, 'must succeed on the 2nd attempt, i.e. exactly 1 retry after the 503');
        assert.equal(metrics.n, 5);
        // The fake API answers RESOLVED + SAYS NOT_RUN for every claim. The first five records
        // declare EXISTS alone — no quote is on them, so nothing was asked of SAYS — and a
        // resolve is the whole of what they asked for. Each therefore scores PASS: wrong, since
        // all five are gold EXISTS_FAIL, but a scored answer rather than an absent one.
        const firstFive = dropUnscoreable(JSON.parse(fs.readFileSync(resolveDatasetPath(REPO_ROOT), 'utf8')).records).slice(0, 5);
        assert.ok(firstFive.every((r) => !r.checks_expected.includes('SAYS')), 'precondition: none of the first five declares SAYS');
        assert.equal(metrics.n_scored, 5);
        assert.equal(metrics.n_insufficient, 0);
        assert.equal(metrics.engine, 'fake-real-api');
        assert.ok(fs.existsSync(path.join(outDir, 'receipts', 'receipt-503-then-200.json')));
        const lines = fs
          .readFileSync(path.join(outDir, 'results.jsonl'), 'utf8')
          .trim()
          .split('\n')
          .map((l) => JSON.parse(l));
        assert.equal(lines.length, 5);
        assert.ok(lines.every((r) => r.predicted !== 'ERROR'));
      });
    } finally {
      server.close();
    }
  });

  test('(b) a batch that always 5xxs is recorded ERROR for its ids after 3 attempts, and the run continues to the next batch', async () => {
    let firstBatchAttempts = 0;
    const secondBatchIds = new Set();
    const { server, api } = await startFakeApi((body, res) => {
      const firstId = body.claims[0].id;
      if (firstId === 'CITW-0001') {
        // The first batch the runner sends: always fails.
        firstBatchAttempts += 1;
        res.writeHead(500);
        res.end('server error, always');
        return;
      }
      // The second batch (the remaining 5): succeeds normally. Which ids those are is the
      // runner's business — read them off the request rather than assuming a contiguous range,
      // since the dataset's unscoreable records are dropped before batching.
      for (const c of body.claims) secondBatchIds.add(c.id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fakeSuccessResponse(body.claims, `receipt-${firstId}`)));
    });
    try {
      await withTempDir(async (outDir) => {
        const metrics = await run({ api, token: 't', limit: 30, budgetUsd: Infinity, mock: false, out: outDir }, FAST_RETRY);
        assert.equal(firstBatchAttempts, 3, 'must give up after 1 initial try + 2 retries');
        assert.equal(metrics.n, 30, 'the run must continue past the failed batch, not abort');

        const lines = fs
          .readFileSync(path.join(outDir, 'results.jsonl'), 'utf8')
          .trim()
          .split('\n')
          .map((l) => JSON.parse(l));
        const firstBatchRows = lines.filter((r) => !secondBatchIds.has(r.id));
        const secondBatchRows = lines.filter((r) => secondBatchIds.has(r.id));
        assert.equal(firstBatchRows.length, BATCH_SIZE);
        assert.ok(firstBatchRows.every((r) => r.predicted === 'ERROR' && r.exists_verdict === null));
        assert.equal(secondBatchRows.length, 30 - BATCH_SIZE);
        // Every batch after the first got a real (fabricated) response from the fake API, so none
        // of their rows are ERROR — this is the "run continues to the next batch" behaviour under
        // test. What label each row ends up with depends on the checks those records declare and
        // is not asserted here; see the mapVerdict suite above for that mapping.
        assert.ok(secondBatchRows.every((r) => r.predicted !== 'ERROR'));
        assert.equal(
          lines.filter((r) => r.predicted === 'ERROR').length,
          BATCH_SIZE,
          'exactly the first batch is ERROR',
        );

        assert.ok(
          !fs.existsSync(path.join(outDir, 'receipts', 'receipt-CITW-0001.json')),
          'a batch that never got a 2xx response must not write a receipt',
        );
      });
    } finally {
      server.close();
    }
  });

  test('(c) realVerify rejects a 4xx with NonRetryableError, in a single request', async () => {
    let attempts = 0;
    const { server, api } = await startFakeApi((_body, res) => {
      attempts += 1;
      res.writeHead(401);
      res.end('unauthorized');
    });
    try {
      const claims = [{ id: 'FAKE-01', locator: { type: 'case', value: 'x' }, quote: null, claim: 'x' }];
      await assert.rejects(() => realVerify({ api, token: 'bad-token' }, claims), NonRetryableError);
      assert.equal(attempts, 1);
    } finally {
      server.close();
    }
  });

  test('(c) postBatchWithRetry does not retry a non-retryable (4xx) error: one attempt, batch recorded as error', async () => {
    let attempts = 0;
    const { server, api } = await startFakeApi((_body, res) => {
      attempts += 1;
      res.writeHead(401);
      res.end('unauthorized');
    });
    try {
      const fakeRecord = { id: 'FAKE-01', verdict_expected: 'PASS', cited_authority: { quoted_text: null } };
      const batchEntries = [{ record: fakeRecord, claim: { id: 'FAKE-01', locator: { type: 'case', value: 'x' }, quote: null, claim: 'x' } }];
      const response = await postBatchWithRetry({ api, token: 'bad-token', mock: false }, batchEntries, 0, FAST_RETRY);
      assert.equal(attempts, 1, '4xx must not be retried');
      assert.equal(response.error, true);
    } finally {
      server.close();
    }
  });

  test('(d) backoff is injectable: sleepFn receives the linear backoffMs * attempt sequence', async () => {
    const sleepCalls = [];
    const sleepFn = (ms) => {
      sleepCalls.push(ms);
      return Promise.resolve();
    };
    let attempts = 0;
    const { server, api } = await startFakeApi((body, res) => {
      attempts += 1;
      if (attempts < 3) {
        res.writeHead(500);
        res.end('server error');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fakeSuccessResponse(body.claims, 'receipt-backoff')));
    });
    try {
      const fakeRecord = { id: 'FAKE-01', verdict_expected: 'PASS', cited_authority: { quoted_text: null } };
      const batchEntries = [{ record: fakeRecord, claim: { id: 'FAKE-01', locator: { type: 'case', value: 'x' }, quote: null, claim: 'x' } }];
      const response = await postBatchWithRetry({ api, token: 't', mock: false }, batchEntries, 0, { sleepFn, backoffMs: 10 });
      assert.equal(attempts, 3, 'fails twice, then succeeds on the 3rd attempt');
      assert.deepEqual(sleepCalls, [10, 20], 'linear backoff: backoffMs * attempt number, once per retry before a terminal attempt');
      assert.equal(response.error, undefined);
    } finally {
      server.close();
    }
  });

  test('every batch lands on disk as it is scored, so a killed run keeps what it measured', async () => {
    // Read what is already written each time the fake API is asked for another batch.
    const seen = [];
    let outDirSeen = null;
    const readIfAny = () => {
      if (!outDirSeen) return { rows: 0, metrics: null };
      const f = path.join(outDirSeen, 'results.jsonl');
      const m = path.join(outDirSeen, 'metrics.json');
      return {
        rows: fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).length : 0,
        metrics: fs.existsSync(m) ? JSON.parse(fs.readFileSync(m, 'utf8')) : null,
      };
    };
    const { server, api } = await startFakeApi((body, res) => {
      seen.push(readIfAny());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(fakeSuccessResponse(body.claims, `receipt-flush-${seen.length}`)));
    });
    try {
      await withTempDir(async (outDir) => {
        outDirSeen = outDir;
        const metrics = await run({ api, token: 't', limit: 60, budgetUsd: Infinity, mock: false, out: outDir }, FAST_RETRY);
        assert.equal(metrics.n, 60);
        assert.equal(seen.length, Math.ceil(60 / BATCH_SIZE), 'one request per batch');
        assert.equal(seen[0].rows, 0, 'nothing is written before the first answer');
        assert.equal(seen[1].rows, BATCH_SIZE, 'the first batch is readable before the second is asked for');
        assert.equal(seen[2].rows, BATCH_SIZE * 2);
        // What is written mid-run says what it is: a partial run, until the last batch lands.
        assert.equal(seen[2].metrics.partial, true);
        assert.equal(seen[2].metrics.n, BATCH_SIZE * 2);
        assert.equal(metrics.partial, false);
        assert.equal(fs.readFileSync(path.join(outDir, 'results.jsonl'), 'utf8').split('\n').filter(Boolean).length, 60);
      });
    } finally {
      server.close();
    }
  });

});
