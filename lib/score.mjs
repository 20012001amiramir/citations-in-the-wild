// Pure scoring functions for Citations in the Wild. No I/O, no network — every function here is
// a function of its inputs only, so it is unit-tested directly (see lib/cli.test.mjs) without
// touching the filesystem, a clock, or the verification API.

export const SCORED_CLASSES = ['EXISTS_FAIL', 'SAYS_FAIL', 'PASS'];

const EXISTS_INSUFFICIENT = new Set(['SOURCE_UNREACHABLE', 'UNSUPPORTED_LOCATOR']);
const EXISTS_RESOLVED = new Set(['RESOLVED', 'RESOLVED_NO_ACCESS']);
const SAYS_FAIL_VERDICTS = new Set(['NOT_FOUND', 'DRIFT']);

/**
 * Maps one record's raw EXISTS/SAYS verdicts from the verification API onto a predicted label:
 * INSUFFICIENT | EXISTS_FAIL | SAYS_FAIL | PASS.
 *
 * `hasQuote` is whether the claim sent to the API carried a verbatim quote
 * (cited_authority.quoted_text was non-null on the source record — see toClaim() in run.mjs). It
 * decides what a SAYS verdict of NOT_RUN means: if there was never a quote to check, NOT_RUN is
 * the correct, expected outcome (PASS — nothing contradicted the citation); if a quote existed
 * and SAYS still didn't run against it, that is a gap in the system under test, not a pass.
 */
export function mapVerdict(existsVerdict, saysVerdict, hasQuote) {
  if (EXISTS_INSUFFICIENT.has(existsVerdict)) return 'INSUFFICIENT';
  if (existsVerdict === 'NOT_FOUND') return 'EXISTS_FAIL';
  if (!EXISTS_RESOLVED.has(existsVerdict)) return 'INSUFFICIENT'; // unrecognised EXISTS verdict

  if (SAYS_FAIL_VERDICTS.has(saysVerdict)) return 'SAYS_FAIL';
  if (saysVerdict === 'MATCH') return 'PASS';
  if (saysVerdict === 'NOT_RUN') return hasQuote ? 'INSUFFICIENT' : 'PASS';
  return 'INSUFFICIENT'; // unrecognised SAYS verdict
}

/** Scores one record: returns { predicted, correct }. `expectedVerdict` is the gold label. */
export function scoreResult(expectedVerdict, existsVerdict, saysVerdict, hasQuote) {
  const predicted = mapVerdict(existsVerdict, saysVerdict, hasQuote);
  return { predicted, correct: predicted === expectedVerdict };
}

function round(x, places) {
  const f = 10 ** places;
  return Math.round(x * f) / f;
}

function precisionRecallF1(tp, fp, fn) {
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { p: round(precision, 3), r: round(recall, 3), f1: round(f1, 3) };
}

/**
 * Aggregates per-record { expected, predicted } pairs into the metrics.json shape EXHIBIT B's
 * /accuracy page consumes verbatim for `benchmark.*` and `methods.exists/says`.
 *
 * `predicted` is one of SCORED_CLASSES, 'INSUFFICIENT', or 'ERROR' (a batch that failed all its
 * HTTP retries — see run.mjs). ERROR is folded into the same "no scoreable verdict" bucket as
 * INSUFFICIENT for n_insufficient/insufficient_share: from the benchmark's point of view both
 * mean the run produced no confident answer for that citation. The finer distinction (why there
 * was no answer) survives per-record in results.jsonl, not in this aggregate.
 *
 * Per-class precision/recall/F1 are computed only over records whose predicted label is one of
 * SCORED_CLASSES — an INSUFFICIENT/ERROR prediction is excluded from the confusion matrix
 * entirely (neither a hit nor a miss for its true class), per the benchmark's scoring rule;
 * insufficient_share is how that exclusion is still visible in the metrics.
 *
 * exists.precision/recall treat EXISTS_FAIL as a binary positive class against everything else
 * (SAYS_FAIL, PASS, INSUFFICIENT, ERROR all count as "rest") over ALL records, not just the
 * scored subset — an INSUFFICIENT/ERROR prediction is simply not a prediction of EXISTS_FAIL.
 *
 * says.match_rate is, of the records whose *expected* label is PASS (the controls), the fraction
 * predicted PASS — again over all of them, so a control that came back INSUFFICIENT counts
 * against the rate rather than disappearing from the denominator.
 *
 * balanced_accuracy is the mean of the three per-class recalls above.
 */
export function computeMetrics(records, meta) {
  const n = records.length;
  const noVerdict = (predicted) => predicted === 'INSUFFICIENT' || predicted === 'ERROR';
  const nInsufficient = records.filter((r) => noVerdict(r.predicted)).length;
  const scored = records.filter((r) => !noVerdict(r.predicted));

  const perClass = {};
  for (const cls of SCORED_CLASSES) {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    for (const r of scored) {
      const predictedCls = r.predicted === cls;
      const expectedCls = r.expected === cls;
      if (predictedCls && expectedCls) tp++;
      else if (predictedCls && !expectedCls) fp++;
      else if (!predictedCls && expectedCls) fn++;
    }
    perClass[cls] = precisionRecallF1(tp, fp, fn);
  }

  let existsTp = 0;
  let existsFp = 0;
  let existsFn = 0;
  for (const r of records) {
    const predictedExistsFail = r.predicted === 'EXISTS_FAIL';
    const expectedExistsFail = r.expected === 'EXISTS_FAIL';
    if (predictedExistsFail && expectedExistsFail) existsTp++;
    else if (predictedExistsFail && !expectedExistsFail) existsFp++;
    else if (!predictedExistsFail && expectedExistsFail) existsFn++;
  }
  const existsPR = precisionRecallF1(existsTp, existsFp, existsFn);

  const passExpected = records.filter((r) => r.expected === 'PASS');
  const saysMatchRate =
    passExpected.length === 0
      ? 0
      : round(passExpected.filter((r) => r.predicted === 'PASS').length / passExpected.length, 3);

  const balancedAccuracy =
    n === 0 ? 0 : round(SCORED_CLASSES.reduce((sum, cls) => sum + perClass[cls].r, 0) / SCORED_CLASSES.length, 3);

  const metrics = {
    date: meta.date,
    n,
    n_scored: scored.length,
    n_insufficient: nInsufficient,
    insufficient_share: n === 0 ? 0 : round(nInsufficient / n, 3),
    partial: Boolean(meta.partial),
    cost_usd: round(meta.costUsd ?? 0, 2),
    exists: { precision: existsPR.p, recall: existsPR.r },
    says: { match_rate: saysMatchRate },
    balanced_accuracy: balancedAccuracy,
    per_class: {
      EXISTS_FAIL: perClass.EXISTS_FAIL,
      SAYS_FAIL: perClass.SAYS_FAIL,
      PASS: perClass.PASS,
    },
  };
  if (meta.engine) metrics.engine = meta.engine;
  return metrics;
}

/**
 * True for a benchmark record that stands for a court's aggregate finding over many citations at
 * once, rather than one specific citation — these are excluded from per-citation scoring.
 *
 * Rule, derived by inspecting citations-in-the-wild.v0.json directly (see benchmark/README.md
 * §1 and §5.7, which describe "5 such aggregate records" without giving a machine-checkable
 * rule): `cited_authority.as_cited` starts with the literal tag "[Aggregate finding]"
 * (case-insensitive). In v0 this matches exactly 4 records — CITW-0183, CITW-0184, CITW-0205,
 * CITW-0216 — all of which also have `cited_authority.case_name` starting "multiple —" and
 * `reporter_citation` "not itemised"/"not itemized in the judgment".
 *
 * A 5th candidate matched by a looser "as_cited starts with '['" rule, CITW-0140
 * ("[unnamed Pennsylvania Superior Court case], 217 A.3d 845 …"), is deliberately NOT excluded:
 * it is a single, fully itemised citation with its own reporter cite, quote and court finding —
 * it just lacks a case *name*, which is a different thing from standing in for many citations at
 * once. See the R2 build report for this count discrepancy (v0.json has 4 aggregate records by
 * any rule that also keeps CITW-0140, not the 5 the prose describes).
 */
export function isAggregateRecord(record) {
  const asCited = record?.cited_authority?.as_cited;
  return typeof asCited === 'string' && /^\[aggregate\b/i.test(asCited.trim());
}

/** Returns `records` with aggregate records (see isAggregateRecord) filtered out. */
export function dropAggregates(records) {
  return records.filter((r) => !isAggregateRecord(r));
}
