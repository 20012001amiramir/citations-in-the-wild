# Citations in the Wild

A public benchmark of citations that courts have themselves ruled on, plus a runner that submits
them to a citation-verification API and publishes open receipts and metrics.

## Why

Systems that check citations in AI-generated text — "does this source exist, and does it say what
it's quoted as saying" — need something to be measured against besides their own vendor's demo.
Court opinions already contain thousands of citations a judge has ruled on: some fabricated, some
misquoting or misrepresenting a real case, and plenty of ordinary, correctly-cited authorities used
as controls. Reading those rulings and turning them into a structured, versioned dataset gives any
verifier something independent to be scored against, and gives anyone the tools to reproduce that
score themselves.

This repo is that dataset (`benchmark/`), the pipeline that built it (`work/`), and a runner
(`run.mjs`) that submits it to a verification API and scores what comes back (`lib/score.mjs`).

## What's in it

```
benchmark/citations-in-the-wild.v0.1.json the dataset: 225 records, 13 source decisions
benchmark/citations-in-the-wild.v0.json   the v0 release, kept as published (CHANGELOG.md)
benchmark/README.md                       full schema, provenance, licence and known limits
work/                                      the harvest -> fetch -> triage -> transcribe -> build
                                           pipeline that produced the dataset (Python)
raw/                                       harvest state (candidate search results); the fetched
                                           PDFs/text themselves are re-derivable, not tracked
run.mjs                                    the runner: submits records to the verification API
lib/score.mjs                             pure scoring functions (unit-tested)
lib/cli.test.mjs                          node:test suite for lib/score.mjs and run.mjs
runs/<date>/                               one directory per published run: results.jsonl,
                                           metrics.json, receipts/
LEADERBOARD.md                             generated from runs/*/metrics.json
scripts/leaderboard.mjs                    regenerates LEADERBOARD.md
scripts/grow.mjs                           wraps the weekly +100-records recipe
```

## Record schema, in brief

One record is one citation as it appeared in a real filing, plus the court's own verbatim finding
about it: what was cited, what it was cited for, whether the authority resolves (`EXISTS`), and
whether it says what it's quoted or cited as saying (`SAYS`). See
[`benchmark/README.md`](benchmark/README.md) for the full field-by-field schema, provenance of all
13 source decisions, and known limits — read it before using the dataset for anything beyond a
quick look.

**Verdict semantics** (what `verdict_expected` means, and what a verifier is expected to report):

- **`EXISTS_FAIL`** — the authority does not resolve (no such case, or the citation string belongs
  to a different case). `EXISTS` must fail; `SAYS` is never reached.
- **`SAYS_FAIL`** — the authority resolves, but does not contain the quoted words or does not
  support what it was cited for. `EXISTS` must pass; `SAYS` must fail.
- **`PASS`** — the authority resolves and says what it's cited for. These are the controls, so
  that a verifier which fails everything does not score well by default.

The dataset documentation uses "ground truth" in its standard evaluation sense; the product site
itself never uses the word.

Not every record can be scored citation by citation. From v0.1 each record carries
`citation_completeness`: `full` (the court printed a citation string a verifier can run against),
`partial` (the court named the parties but never reproduced the citation — two Shahid records) or
`aggregate` (a bulk finding such as "eighteen of forty-five citations..." — four records).
`lib/score.mjs`'s `dropUnscoreable` keeps only `full`, which is the file's own
`counts.scoreable_per_citation` (219 of 225). A record without the field is a v0 record, where the
only exclusion is the literal `[Aggregate finding]` tag at the start of `cited_authority.as_cited`
(`isAggregateRecord`, case-insensitive; 4 of 223). `CITW-0140` is deliberately kept under both
rules: it is a single, fully itemised citation that merely lacked a case *name* in v0.

## How to run

Requires Node >= 18 (global `fetch`) and zero npm dependencies.

```sh
node run.mjs --api https://exhibitb.autofract.com --token $INTERNAL_TOKEN --budget-usd 1.50
node scripts/leaderboard.mjs
```

`run.mjs` reads the benchmark, drops the aggregate records, maps each remaining record to a claim,
and POSTs batches of 25 to `{api}/api/internal/verify` (`Authorization: Bearer <token>`) until
either every record is scored or cumulative `cost_usd` would exceed `--budget-usd` (the run is then
marked `partial: true` and stops — it does not submit further batches once over budget). A batch
that fails after three attempts (one try plus two retries on 5xx/network errors) is recorded as
`ERROR` for its ids; the run continues with the next batch rather than aborting.

Full flag list:

```
--api <url>          base URL of the verification API (required unless --mock)
--token <token>       bearer token (required unless --mock)
--limit N             only score the first N non-aggregate records
--budget-usd N        stop once cumulative cost would exceed this
--mock                fabricate plausible verdicts locally — no network, no token needed
--out DIR             output directory (default: runs/<today, YYYY-MM-DD>)
```

Every run writes `<out>/results.jsonl` (one JSON line per record — id, expected verdict, the raw
`EXISTS`/`SAYS` verdicts returned, the predicted label, and whether it matched), `<out>/metrics.json`
(the aggregate scoring — see below), and `<out>/receipts/<id>.json` (whatever the API returned as
each batch's receipt), and prints a short summary.

**Try it without the live API:**

```sh
node run.mjs --mock --limit 30 --out .tmp-runs/demo
```

`--mock` fabricates verdicts deterministically (by record id, not by RNG), so it is reproducible
and safe offline. It exists so the whole pipeline — batching, retries, budget stop, scoring,
writing runs/, regenerating the leaderboard — is exercisable and testable before the real
verification API is live.

### Scoring

`lib/score.mjs` maps the raw `EXISTS`/`SAYS` verdicts onto one of four predicted labels
(`INSUFFICIENT`, `EXISTS_FAIL`, `SAYS_FAIL`, `PASS`) and aggregates per-record results into
`metrics.json`:

- Per-class precision/recall/F1 for `EXISTS_FAIL` / `SAYS_FAIL` / `PASS`, computed only over
  records that got a scoreable prediction (an `INSUFFICIENT` or `ERROR` prediction is excluded from
  the confusion matrix, not counted as a miss) — `insufficient_share` is how that exclusion still
  shows up in the metrics.
- `exists.precision` / `exists.recall` — `EXISTS_FAIL` treated as a binary positive class against
  everything else, over *all* records.
- `says.match_rate` — of the control (`PASS`-expected) records, the fraction predicted `PASS`.
- `balanced_accuracy` — the mean of the three per-class recalls.

Run `node --test lib/*.test.mjs` (or plain `node --test`, which discovers the same file by
default) to see every mapping branch, the aggregate-exclusion rule, the budget-stop behaviour, and
a `--mock` run scored end-to-end. (A bare `node --test lib/` should also work per Node's own docs;
if it errors with a directory-resolution `MODULE_NOT_FOUND` on your platform/Node build, that is a
known upstream test-runner issue with directory arguments, not a problem with this repo — use one
of the two forms above instead.)

### Verify a run yourself

Nothing here needs to be taken on trust: `results.jsonl` has one line per citation, so anyone can
recompute `metrics.json` by re-running `lib/score.mjs`'s `computeMetrics` over it, and every
citation's `locator` points at the same public, government-edict, copyright-free court opinion the
dataset itself cites — resolve it yourself and compare.

## How to extend: +100 records/week

The pipeline in `work/` is already reproducible. `scripts/grow.mjs` wraps its automatic steps
(re-harvest against CourtListener, fetch + extract new opinions, triage/rank candidates) and then
stops to print exactly what to read and transcribe next — reading a judge's finding and turning it
into a record is a judgment call this repo leaves to a person, on purpose; the script makes no
model calls and transcribes nothing itself.

```sh
pip install -r work/requirements.txt
node scripts/grow.mjs
```

See [`benchmark/README.md` §6](benchmark/README.md#6-how-to-extend-by-100-records-per-week) for
the full weekly recipe, quality gates, and the worklist for the first non-US extension.

## robots.txt rules

This corpus was built without scraping any site that disallows automated retrieval for this agent.
**Never scrape** damiencharlotin.com, AustLII, CanLII, BAILII, or Find Case Law — all five serve a
`Disallow` that covers this agent. CourtListener's public search API and storage, and the UK's
Courts and Tribunals Judiciary site, permit it and were used instead. See
[`benchmark/README.md` §4](benchmark/README.md#4-what-was-not-used-and-why) for the full
per-source robots.txt breakdown and reasoning.

## Licence

Two licences, covering two different kinds of content — see [`LICENSE`](LICENSE) for the full
text:

- **Code** (`run.mjs`, `lib/`, `scripts/`, `work/*.py`, `.github/`) — MIT.
- **Dataset & labels** (`benchmark/citations-in-the-wild.v*.json`, `benchmark/README.md`,
  `work/records/*.json`) — CC BY 4.0. The underlying court decisions are public record and are not
  themselves covered by this licence; what's licensed is this benchmark's own contribution on top
  of them — selection, per-citation segmentation, verdict labels, and schema. Decisions are public
  record; the selection and labelling on top of them is ours to license, and we do so openly so the
  next person's benchmark run — and the next 100 records — can build on it without asking.
