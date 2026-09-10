// Pure scoring functions for Citations in the Wild. No I/O, no network — every function here is
// a function of its inputs only, so it is unit-tested directly (see lib/cli.test.mjs) without
// touching the filesystem, a clock, or the verification API.

export const SCORED_CLASSES = ['EXISTS_FAIL', 'SAYS_FAIL', 'PASS'];

const EXISTS_INSUFFICIENT = new Set(['SOURCE_UNREACHABLE', 'UNSUPPORTED_LOCATOR']);
const EXISTS_RESOLVED = new Set(['RESOLVED', 'RESOLVED_NO_ACCESS']);
const SAYS_FAIL_VERDICTS = new Set(['NOT_FOUND', 'DRIFT']);

/** The checks an EXISTS/SAYS run can actually make. Anything else a record declares, it cannot. */
const RUNNABLE_CHECKS = new Set(['EXISTS', 'SAYS']);

/** What a record declares when it does not say — the v0/v0.1 shape, where every record asked for both. */
const LEGACY_CHECKS = ['EXISTS', 'SAYS'];

/**
 * The checks a record declares. From v0.2 `checks_expected` is an array naming them
 * (`["EXISTS"]`, `["EXISTS","SAYS"]`, `["EXISTS","HOLDS"]`), derived from the material the record
 * carries. Earlier files declared both checks on every record — as the object
 * `{ EXISTS: "FAIL", SAYS: "NOT_REACHED" }` in v0 and v0.1, and as nothing at all where a caller
 * passed the old `hasQuote` boolean — and both of those read back as EXISTS + SAYS, which is what
 * they meant and how they were scored.
 */
export function declaredChecks(checksExpected) {
  if (Array.isArray(checksExpected)) return checksExpected;
  if (checksExpected && typeof checksExpected === 'object') return Object.keys(checksExpected);
  return LEGACY_CHECKS;
}

/**
 * Maps one record's raw EXISTS/SAYS verdicts from the verification API onto a predicted label:
 * INSUFFICIENT | EXISTS_FAIL | SAYS_FAIL | PASS.
 *
 * The prediction is made against the checks the record itself declares (`checks_expected`, see
 * declaredChecks) and against no others: PASS when every declared check passed, EXISTS_FAIL or
 * SAYS_FAIL when the matching check failed, INSUFFICIENT when a declared check could not run.
 *
 * A record declaring `["EXISTS"]` — nothing on it for SAYS to read — is a PASS on a resolve
 * alone, and whatever comes back on the SAYS line changes nothing. A record declaring
 * `["EXISTS","SAYS"]` needs the SAYS verdict too, and a NOT_RUN there is INSUFFICIENT: a check
 * that did not run has shown nothing. (Until 2026-09-08 a NOT_RUN without a quote counted as
 * PASS, which credited records whose SAYS check never runs as passes. Treating NOT_RUN as
 * insufficient was right and stays; what was wrong was every record asking for SAYS.)
 *
 * A record declaring a check this run does not make — `HOLDS` — is INSUFFICIENT, though in
 * practice it never reaches here: dropUnscoreable removes those before a run starts.
 */
export function mapVerdict(existsVerdict, saysVerdict, checksExpected) {
  const checks = declaredChecks(checksExpected);

  // EXISTS is declared by every record, and its outcome short-circuits everything after it.
  if (EXISTS_INSUFFICIENT.has(existsVerdict)) return 'INSUFFICIENT';
  if (existsVerdict === 'NOT_FOUND') return 'EXISTS_FAIL';
  if (!EXISTS_RESOLVED.has(existsVerdict)) return 'INSUFFICIENT'; // unrecognised EXISTS verdict

  // The authority resolved. Every other check the record declares has to have passed as well.
  for (const check of checks) {
    if (check === 'EXISTS') continue;
    if (!RUNNABLE_CHECKS.has(check)) return 'INSUFFICIENT'; // declared, but this run cannot run it
    if (SAYS_FAIL_VERDICTS.has(saysVerdict)) return 'SAYS_FAIL';
    if (saysVerdict !== 'MATCH') return 'INSUFFICIENT'; // NOT_RUN, or an unrecognised SAYS verdict
  }
  return 'PASS';
}

/**
 * Scores one record: returns { predicted, correct }. `expectedVerdict` is the gold label and
 * `checksExpected` the record's own `checks_expected` (declaredChecks covers the older shapes).
 */
export function scoreResult(expectedVerdict, existsVerdict, saysVerdict, checksExpected) {
  const predicted = mapVerdict(existsVerdict, saysVerdict, checksExpected);
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
/**
 * How many citations each way of asking the registry answered.
 *
 * The exact lookup is rationed by the day; past it a run falls back to the open search, which is a
 * different instrument — it can settle on a record that merely shares a surname with the case, and
 * did. A published figure that blended the two without saying so would be a figure about nothing,
 * so the split travels with the numbers rather than in somebody's memory of which day it was.
 */
export function methodSplit(rows) {
  const out = {};
  for (const r of rows) {
    const key = r?.registry_method ?? "none";
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

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
    // Which instrument answered how many of them. A run longer than the registry's daily ration
    // finishes on the open search, which is a different instrument from the exact lookup, and a
    // headline number that blended the two silently would be a number about nothing.
    registry_methods: methodSplit(records),
  };
  if (meta.engine) metrics.engine = meta.engine;
  return metrics;
}

/**
 * True for a benchmark record that stands for a court's aggregate finding over many citations at
 * once, rather than one specific citation. v0 carried no explicit marker, so the rule is the
 * literal tag "[Aggregate finding]" at the start of `cited_authority.as_cited` (case-insensitive);
 * in v0 that matches exactly 4 records — CITW-0183, CITW-0184, CITW-0205, CITW-0216. A looser
 * "starts with '['" rule would also catch CITW-0140, a single itemised citation that merely lacked
 * a case name in v0 (v0.1 restored the name), which is why the tag itself is the rule.
 */
export function isAggregateRecord(record) {
  const asCited = record?.cited_authority?.as_cited;
  return typeof asCited === 'string' && /^\[aggregate\b/i.test(asCited.trim());
}

/**
 * True for a record whose every declared check is one an EXISTS/SAYS run makes. False for the
 * records that declare `HOLDS` — a says-layer failure the court found without printing a quote to
 * check it against. A run of these two checks has nothing to say about those either way, so they
 * are left out of its denominator rather than counted as insufficient answers to a question that
 * was never asked. A record with no `checks_expected` array is a v0/v0.1 record, which asked for
 * EXISTS and SAYS and nothing else.
 */
export function declaresOnlyExistsSays(record) {
  const checks = record?.checks_expected;
  if (!Array.isArray(checks)) return true;
  return checks.every((check) => RUNNABLE_CHECKS.has(check));
}

/**
 * True for a record a verifier can be scored on citation by citation. From v0.1 every record
 * carries `citation_completeness` — `full` is scoreable; `partial` (the court named the parties but
 * printed no citation) and `aggregate` (a bulk finding) are not, per benchmark/README.md §1. A
 * record without the field is a v0 record, where only the aggregate tag excludes it.
 */
export function isScoreableRecord(record) {
  const completeness = record?.citation_completeness;
  if (typeof completeness === 'string') return completeness === 'full';
  return !isAggregateRecord(record);
}

/**
 * Returns `records` without the ones an EXISTS/SAYS run cannot score: the ones that carry no
 * citation of their own (isScoreableRecord) and the ones whose declared checks reach past those
 * two (declaresOnlyExistsSays). On the current dataset that is `counts.scoreable_exists_says`.
 */
export function dropUnscoreable(records) {
  return records.filter((record) => isScoreableRecord(record) && declaresOnlyExistsSays(record));
}

/** @deprecated name kept for callers written against v0; same filter as dropUnscoreable. */
export function dropAggregates(records) {
  return dropUnscoreable(records);
}
