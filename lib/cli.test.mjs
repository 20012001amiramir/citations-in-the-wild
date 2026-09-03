// node:test suite for the whole Node side of Citations in the Wild: the pure scoring module
// (lib/score.mjs) and the runner (../run.mjs). One file, per the repo layout — see README.md.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { mapVerdict, computeMetrics, isAggregateRecord, dropAggregates } from './score.mjs';

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
    ['RESOLVED', 'NOT_RUN', false, 'PASS'], // no quote was ever sent to check -> nothing to fail
    ['RESOLVED', 'NOT_RUN', true, 'INSUFFICIENT'], // a quote existed but SAYS was never run on it
    ['RESOLVED_NO_ACCESS', 'NOT_RUN', false, 'PASS'],
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

  test('dropAggregates removes exactly the 4 aggregate records from the real v0 dataset', () => {
    const benchmarkPath = path.join(REPO_ROOT, 'benchmark', 'citations-in-the-wild.v0.json');
    const data = JSON.parse(fs.readFileSync(benchmarkPath, 'utf8'));
    assert.equal(data.records.length, 223);

    const kept = dropAggregates(data.records);
    const dropped = data.records.filter((r) => !kept.includes(r));

    assert.equal(dropped.length, 4);
    assert.deepEqual(
      dropped.map((r) => r.id).sort(),
      ['CITW-0183', 'CITW-0184', 'CITW-0205', 'CITW-0216'],
    );
    assert.equal(kept.length, 219);
    // CITW-0140 (the unnamed-but-itemised case) must survive.
    assert.ok(kept.some((r) => r.id === 'CITW-0140'));
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

  test('drops the 4 aggregate records before batching (223 total -> 219 available)', () => {
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
