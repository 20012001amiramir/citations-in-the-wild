#!/usr/bin/env node
// Citations in the Wild — runner. Reads the newest benchmark/citations-in-the-wild.v*.json,
// submits each per-citation scoreable record to EXHIBIT B's verification API in batches of 25, scores the responses
// against the benchmark's gold verdicts (lib/score.mjs), and writes runs/<date>/{results.jsonl,
// metrics.json, receipts/*.json}. See README.md "How to run" for the CLI contract.
//
// Zero npm dependencies — only Node's built-ins (fetch is global since Node 18).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

import { scoreResult, computeMetrics, dropUnscoreable } from './lib/score.mjs';
import { resolveDatasetPath } from './lib/dataset.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BATCH_SIZE = 25;
const MAX_ATTEMPTS = 3; // 1 initial attempt + 2 retries
const RETRY_BASE_MS = 300;

export class NonRetryableError extends Error {}

function usage() {
  return [
    'Usage: node run.mjs --api <url> --token <token> [--limit N] [--budget-usd N] [--mock] [--out DIR]',
    '',
    '  --api          Base URL of the EXHIBIT B verification API (required unless --mock).',
    '  --token        Bearer token for Authorization header (required unless --mock).',
    '  --limit        Only score the first N records (after dropping the ones this run cannot score).',
    '  --budget-usd   Stop submitting further batches once cumulative cost_usd would exceed this.',
    '  --mock         Fabricate plausible verdicts instead of calling the API (no network).',
    '  --out          Output directory. Defaults to runs/<today, YYYY-MM-DD>.',
  ].join('\n');
}

export function parseArgs(argv) {
  const args = { api: null, token: null, limit: null, budgetUsd: Infinity, mock: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--api':
        args.api = argv[++i];
        break;
      case '--token':
        args.token = argv[++i];
        break;
      case '--limit':
        args.limit = Number(argv[++i]);
        break;
      case '--budget-usd':
        args.budgetUsd = Number(argv[++i]);
        break;
      case '--mock':
        args.mock = true;
        break;
      case '--out':
        args.out = argv[++i];
        break;
      case '--help':
      case '-h':
        console.log(usage());
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${a}\n\n${usage()}`);
    }
  }
  if (!args.mock && !args.api) throw new Error(`--api is required unless --mock is set\n\n${usage()}`);
  if (!args.mock && !args.token) throw new Error(`--token is required unless --mock is set\n\n${usage()}`);
  if (args.limit !== null && (!Number.isFinite(args.limit) || args.limit < 0)) {
    throw new Error('--limit must be a non-negative number');
  }
  if (!Number.isFinite(args.budgetUsd) && args.budgetUsd !== Infinity) {
    throw new Error('--budget-usd must be a number');
  }
  return args;
}

/** The most context characters the verification API accepts on a claim. */
export const CONTEXT_MAX = 600;

/**
 * The words around the citation, for the verifier to read the parties, the court and the year
 * from — the same read it gives a document's own text. A record that carries the text the filing
 * printed around the citation (`surrounding_text`) sends that; otherwise the citation as cited,
 * with the record's own spelling of the case name in front of it only when `as_cited` opens with
 * the citation itself and so names nobody. A citation that already carries a caption is sent
 * alone: prefixing the name would print the caption twice in two spellings, which is a string no
 * filing prints, and the parties read back out of it would be neither.
 */
export function contextOf(cited) {
  const own = typeof cited.surrounding_text === 'string' ? cited.surrounding_text.trim() : '';
  if (own) return own.slice(0, CONTEXT_MAX);
  const as = String(cited.as_cited ?? '').trim();
  const name = typeof cited.case_name === 'string' ? cited.case_name.trim() : '';
  const capless = /^[\d[(]/.test(as);
  const text = name && capless ? `${name}, ${as}` : as;
  return text.slice(0, CONTEXT_MAX);
}

/** Maps one benchmark record onto the claim shape the verification API expects. */
export function toClaim(record) {
  return {
    id: record.id,
    locator: { type: 'case', value: record.cited_authority.as_cited },
    quote: record.cited_authority.quoted_text ?? null,
    claim: record.cited_authority.cited_for ?? record.cited_authority.as_cited,
    context: contextOf(record.cited_authority),
  };
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function round(x, places) {
  const f = 10 ** places;
  return Math.round(x * f) / f;
}

/** Deterministic small hash, used only to make --mock output varied but reproducible. */
function hashId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Fabricates a plausible-but-imperfect verify response for one batch, entirely offline.
 *
 * It is not a random fuzzer and not a perfect oracle: for each record it mostly returns the
 * verdicts that would reproduce the gold label, so a --mock run's metrics look like a real,
 * decent-but-imperfect run rather than either a trivial 100% or noise. About 1 in 20 records
 * (deterministic by id, not by RNG, so --mock is reproducible across runs and platforms) gets a
 * SOURCE_UNREACHABLE instead, landing on INSUFFICIENT — this is what exercises the
 * insufficient_share / n_insufficient path in a --mock run without needing the real API.
 */
function mockVerify(batchEntries, batchIndex) {
  const results = batchEntries.map(({ record }) => {
    const hasQuote = record.cited_authority?.quoted_text != null;
    const h = hashId(record.id);
    const noisy = h % 20 === 0;
    let existsVerdict;
    let saysVerdict;
    if (noisy) {
      existsVerdict = 'SOURCE_UNREACHABLE';
      saysVerdict = 'NOT_RUN';
    } else if (record.verdict_expected === 'EXISTS_FAIL') {
      existsVerdict = 'NOT_FOUND';
      saysVerdict = 'NOT_RUN';
    } else {
      existsVerdict = h % 2 === 0 ? 'RESOLVED' : 'RESOLVED_NO_ACCESS';
      if (record.verdict_expected === 'SAYS_FAIL') {
        saysVerdict = h % 3 === 0 ? 'DRIFT' : 'NOT_FOUND';
      } else {
        // PASS
        saysVerdict = hasQuote ? 'MATCH' : 'NOT_RUN';
      }
    }
    return {
      id: record.id,
      exists: { verdict: existsVerdict },
      says: { verdict: saysVerdict },
      cost_usd: 0.01,
    };
  });
  const costUsd = round(
    results.reduce((sum, r) => sum + r.cost_usd, 0),
    4,
  );
  return {
    results,
    receipt: { id: `mock-${String(batchIndex).padStart(4, '0')}`, self_hash: `mock-hash-${hashId(String(batchIndex))}`, seq: batchIndex },
    cost_usd: costUsd,
    engine: 'mock-v0',
  };
}

export async function realVerify(args, claims) {
  let res;
  try {
    res = await fetch(`${args.api}/api/internal/verify`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ claims, says: 'all', archive: false, holds: { ids: [] } }),
    });
  } catch (err) {
    // Network-level failure (DNS, connection refused, timeout, ...) — retryable.
    throw new Error(`network error: ${err.message}`);
  }
  if (res.status >= 500) {
    // Server-side failure — retryable.
    throw new Error(`server error ${res.status}`);
  }
  if (!res.ok) {
    // 4xx: the request itself is wrong (bad token, malformed body). Retrying won't help.
    const body = await res.text().catch(() => '');
    throw new NonRetryableError(`client error ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Sends one batch, retrying on 5xx/network failures with linear backoff. A batch that still
 * fails after `maxAttempts` total tries (default 3: 1 initial + 2 retries) is reported as
 * `{ error: true }` to the caller, which records ERROR for every id in that batch and continues
 * with the next batch — one bad batch does not abort the run.
 *
 * `sleepFn` and `backoffMs` are injectable (default: the real `timers/promises` sleep and
 * RETRY_BASE_MS) purely so tests can drive retries in milliseconds instead of real backoff time —
 * the CLI never passes these, so its behaviour is unchanged.
 */
export async function postBatchWithRetry(args, batchEntries, batchIndex, options = {}) {
  const { sleepFn = sleep, backoffMs = RETRY_BASE_MS, maxAttempts = MAX_ATTEMPTS } = options;
  const claims = batchEntries.map((e) => e.claim);
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return args.mock ? mockVerify(batchEntries, batchIndex) : await realVerify(args, claims);
    } catch (err) {
      lastErr = err;
      if (err instanceof NonRetryableError) break;
      if (attempt < maxAttempts) await sleepFn(backoffMs * attempt);
    }
  }
  process.stderr.write(`batch ${batchIndex} (${claims.length} claims) failed: ${lastErr?.message}\n`);
  return { error: true };
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

export async function run(args, retryOptions = {}) {
  const benchmarkPath = resolveDatasetPath(__dirname);
  const data = JSON.parse(fs.readFileSync(benchmarkPath, 'utf8'));
  const kept = dropUnscoreable(data.records);
  const records = args.limit === null ? kept : kept.slice(0, args.limit);

  const date = todayUtc();
  const outDir = args.out ? path.resolve(process.cwd(), args.out) : path.join(__dirname, 'runs', date);
  const receiptsDir = path.join(outDir, 'receipts');
  fs.mkdirSync(receiptsDir, { recursive: true });

  const entries = records.map((record) => ({ record, claim: toClaim(record) }));
  const batches = chunk(entries, BATCH_SIZE);

  const resultLines = [];
  const scored = [];
  let cumulativeCost = 0;
  let partial = false;
  let engine;

  for (let i = 0; i < batches.length; i++) {
    const batchEntries = batches[i];
    const response = await postBatchWithRetry(args, batchEntries, i, retryOptions);

    if (response.error) {
      for (const { record } of batchEntries) {
        const row = {
          id: record.id,
          expected: record.verdict_expected,
          exists_verdict: null,
          says_verdict: null,
          predicted: 'ERROR',
          correct: false,
        };
        resultLines.push(row);
        scored.push({ expected: row.expected, predicted: row.predicted });
      }
      continue;
    }

    cumulativeCost += response.cost_usd ?? 0;
    if (response.engine) engine = response.engine;
    if (response.receipt) {
      const receiptPath = path.join(receiptsDir, `${response.receipt.id}.json`);
      fs.writeFileSync(receiptPath, `${JSON.stringify(response.receipt, null, 2)}\n`);
    }

    const resultById = new Map((response.results ?? []).map((r) => [r.id, r]));
    for (const { record } of batchEntries) {
      const apiResult = resultById.get(record.id);
      const existsVerdict = apiResult?.exists?.verdict ?? null;
      const saysVerdict = apiResult?.says?.verdict ?? null;
      // Scored against the checks this record declares, and no others — see lib/score.mjs.
      const { predicted, correct } = scoreResult(record.verdict_expected, existsVerdict, saysVerdict, record.checks_expected);
      const row = {
        id: record.id,
        expected: record.verdict_expected,
        exists_verdict: existsVerdict,
        says_verdict: saysVerdict,
        predicted,
        correct,
      };
      resultLines.push(row);
      scored.push({ expected: row.expected, predicted: row.predicted });
    }

    const hasMoreBatches = i < batches.length - 1;
    if (cumulativeCost > args.budgetUsd && hasMoreBatches) {
      partial = true;
      break;
    }
  }

  fs.writeFileSync(
    path.join(outDir, 'results.jsonl'),
    resultLines.map((r) => JSON.stringify(r)).join('\n') + (resultLines.length ? '\n' : ''),
  );

  const metrics = computeMetrics(scored, { date, partial, costUsd: cumulativeCost, engine });
  fs.writeFileSync(path.join(outDir, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);

  printSummary(metrics, outDir);
  return metrics;
}

function printSummary(m, outDir) {
  const lines = [
    `Citations in the Wild — run ${m.date}${m.partial ? ' (PARTIAL)' : ''}`,
    `records: ${m.n} scored=${m.n_scored} insufficient=${m.n_insufficient} (${(m.insufficient_share * 100).toFixed(1)}%)`,
    `balanced accuracy: ${m.balanced_accuracy}`,
    `exists precision/recall: ${m.exists.precision} / ${m.exists.recall}`,
    `says match rate: ${m.says.match_rate}`,
    `cost: $${m.cost_usd.toFixed(2)} -> ${outDir}`,
  ];
  console.log(lines.join('\n'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await run(args);
}

const isMain = path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
