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

import { mapVerdict, computeMetrics, isAggregateRecord, dropAggregates, dropUnscoreable } from './score.mjs';
import { resolveDatasetPath } from './dataset.mjs';
import { run, postBatchWithRetry, realVerify, NonRetryableError, toClaim, contextOf, CONTEXT_MAX } from '../run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

describe('mapVerdict — every branch of the EXISTS/SAYS -> predicted-label mapping', () => {
  // [existsVerdict, saysVerdict, hasQuote, want]
  const cases = [
    ['SOURCE_UNREACHABLE', null, false, 'INSUFFICIENT'],
    ['UNSUPPORTED_LOCATOR', 'MATCH', false, 'INSUFFICIENT'], // says is irrelevant once EXISTS is insufficient
    ['NOT_FOUND', null, false, 'EXISTS_FAIL'],
    ['NOT_FOUND', 'MATCH', true, 'EXISTS_FAIL'], // says is irrelevant once EXISTS has failed outright
    ['RESOLVED', 'NOT_FOUND', false, 'SAYS_FAIL'],
    ['RESOLVED_NO_ACCESS', 'DRIFT', false, 'SAYS_FAIL'],
    ['RESOLVED', 'MATCH', false, 'PASS'],
    ['RESOLVED_NO_ACCESS', 'MATCH', true, 'PASS'],
    ['RESOLVED', 'NOT_RUN', false, 'INSUFFICIENT'], // nothing ran -> nothing was shown, either way
    ['RESOLVED', 'NOT_RUN', true, 'INSUFFICIENT'], // a quote existed but SAYS was never run on it
    ['RESOLVED_NO_ACCESS', 'NOT_RUN', false, 'INSUFFICIENT'],
    ['RESOLVED', 'SOME_FUTURE_VERDICT', false, 'INSUFFICIENT'], // defensive: unknown SAYS verdict
  ];
  assert.equal(cases.length, 12, 'fixture must have exactly 12 records');

  for (const [exists, says, hasQuote, want] of cases) {
    test(`EXISTS=${exists} SAYS=${says} hasQuote=${hasQuote} -> ${want}`, () => {
      assert.equal(mapVerdict(exists, says, hasQuote), want);
    });
  }

  test('defensive: unknown EXISTS verdict -> INSUFFICIENT', () => {
    assert.equal(mapVerdict('SOME_FUTURE_VERDICT', 'MATCH', false), 'INSUFFICIENT');
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

  test('context is as_cited when it already opens with the case name, and the name prefixed when it does not', () => {
    assert.equal(contextOf(cited()), 'Eduardo v. Garland, 28 F.4th 742 (9th Cir. 2022)');
    assert.equal(contextOf(cited({ as_cited: 'Kelly v. Conn. Mut. Life Ins. Co., 628 So. 2d 454 (Ala. 1993)', case_name: 'Kelly v. Connecticut Mut. Life Ins. Co.' })), 'Kelly v. Connecticut Mut. Life Ins. Co., Kelly v. Conn. Mut. Life Ins. Co., 628 So. 2d 454 (Ala. 1993)');
    assert.equal(contextOf(cited({ case_name: null })), 'Eduardo v. Garland, 28 F.4th 742 (9th Cir. 2022)');
  });

  test("a record's own surrounding text wins, and the context never exceeds the API's cap", () => {
    assert.equal(contextOf(cited({ surrounding_text: ' See Eduardo v. Garland, 28 F.4th 742 (9th Cir. 2022). ' })), 'See Eduardo v. Garland, 28 F.4th 742 (9th Cir. 2022).');
    const long = contextOf(cited({ surrounding_text: 'x'.repeat(CONTEXT_MAX + 50) }));
    assert.equal(long.length, CONTEXT_MAX);
    assert.equal(contextOf(cited({ case_name: 'N'.repeat(CONTEXT_MAX) })).length, CONTEXT_MAX);
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

  test('dropUnscoreable removes the 4 aggregate and 2 partial records from the current dataset', () => {
    const benchmarkPath = resolveDatasetPath(REPO_ROOT);
    assert.equal(path.basename(benchmarkPath), 'citations-in-the-wild.v0.1.json');
    const data = JSON.parse(fs.readFileSync(benchmarkPath, 'utf8'));
    assert.equal(data.records.length, 225);

    const kept = dropUnscoreable(data.records);
    const dropped = data.records.filter((r) => !kept.includes(r));

    assert.equal(dropped.length, 6);
    assert.deepEqual(
      dropped.map((r) => r.id).sort(),
      ['CITW-0183', 'CITW-0184', 'CITW-0205', 'CITW-0216', 'CITW-0224', 'CITW-0225'],
    );
    assert.deepEqual(
      dropped.map((r) => r.citation_completeness).sort(),
      ['aggregate', 'aggregate', 'aggregate', 'aggregate', 'partial', 'partial'],
    );
    assert.equal(kept.length, 219);
    assert.equal(kept.length, data.counts.scoreable_per_citation);
    // CITW-0140 (the once-unnamed but itemised case) must survive.
    assert.ok(kept.some((r) => r.id === 'CITW-0140'));
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

  test('drops the 4 aggregate and 2 partial records before batching (225 total -> 219 available)', () => {
    withTempDir((outDir) => {
      runMock([], outDir); // no --limit: the full non-aggregate dataset
      const metrics = JSON.parse(fs.readFileSync(path.join(outDir, 'metrics.json'), 'utf8'));
      assert.equal(metrics.n, 219);
    });
  });

  test('budget stop: cuts the run short and marks partial:true once cost exceeds --budget-usd', () => {
    withTempDir((outDir) => {
      // --mock costs a fixed $0.01/record => $0.25 per batch of 25. --limit 60 makes 3 batches
      // (25, 25, 10). A $0.30 budget allows batch 1 (cumulative $0.25) but not batch 2
      // (cumulative $0.50), and batch 3 still has records waiting, so the run must stop right
      // after batch 2 with exactly 50 scored records and partial:true.
      runMock(['--limit', '60', '--budget-usd', '0.30'], outDir);
      const metrics = JSON.parse(fs.readFileSync(path.join(outDir, 'metrics.json'), 'utf8'));
      assert.equal(metrics.partial, true);
      assert.equal(metrics.n, 50);
      assert.equal(metrics.cost_usd, 0.5);

      const lines = fs.readFileSync(path.join(outDir, 'results.jsonl'), 'utf8').trim().split('\n');
      assert.equal(lines.length, 50);
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
        assert.equal(attempts, 2, 'must succeed on the 2nd attempt, i.e. exactly 1 retry after the 503');
        assert.equal(metrics.n, 5);
        // the fake API answers RESOLVED + SAYS NOT_RUN: a check that did not run scores as
        // INSUFFICIENT, so nothing here counts as scored (see mapVerdict)
        assert.equal(metrics.n_scored, 0);
        assert.equal(metrics.n_insufficient, 5);
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
    const { server, api } = await startFakeApi((body, res) => {
      const firstId = body.claims[0].id;
      if (firstId === 'CITW-0001') {
        // The first batch (ids CITW-0001..0025): always fails.
        firstBatchAttempts += 1;
        res.writeHead(500);
        res.end('server error, always');
        return;
      }
      // The second batch (ids CITW-0026..0030): succeeds normally.
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
        const firstBatchRows = lines.filter((r) => r.id <= 'CITW-0025');
        const secondBatchRows = lines.filter((r) => r.id > 'CITW-0025');
        assert.equal(firstBatchRows.length, 25);
        assert.ok(firstBatchRows.every((r) => r.predicted === 'ERROR' && r.exists_verdict === null));
        assert.equal(secondBatchRows.length, 5);
        // The 2nd batch got a real (fabricated) response from the fake API, so none of its rows
        // are ERROR — this is the "run continues to the next batch" behaviour under test. (Some
        // of these 5 real records carry a quote, which a RESOLVED+NOT_RUN response correctly maps
        // to INSUFFICIENT rather than PASS per lib/score.mjs — that's unrelated to error-handling
        // and not asserted here; see lib/cli.test.mjs's mapVerdict suite for that mapping.)
        assert.ok(secondBatchRows.every((r) => r.predicted !== 'ERROR'));
        assert.equal(
          lines.filter((r) => r.predicted === 'ERROR').length,
          25,
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
});
