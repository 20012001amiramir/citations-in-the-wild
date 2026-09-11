# LEADERBOARD

Dated runs of `run.mjs` against citations-in-the-wild, scored per [`lib/score.mjs`](lib/score.mjs).
This table lists **our own runs only** — see [`README.md`](README.md) for what each column means
and why we don't accept third-party-submitted numbers.

| Date | n | Balanced accuracy | EXISTS P/R | SAYS match | INSUFFICIENT share | Partial |
|---|---|---|---|---|---|---|
| 2026-09-08 | 219 | 0.667 | 1 / 0.284 | 0 | 88.1% | no |
| 2026-09-09 | 50 | 0.667 | 0 / 0 | 0.421 | 74.0% | yes |
| 2026-09-10 | 197 | 0.96 | 1 / 0.392 | 0.543 | 60.4% | no |
| 2026-09-11 | 197 | 0.956 | 1 / 0.351 | 0.571 | 60.9% | no |

## Run it yourself

```sh
node run.mjs --api https://exhibitb.autofract.com --token $INTERNAL_TOKEN --budget-usd 1.50
node scripts/leaderboard.mjs
```

This regenerates this file from every `runs/<date>/metrics.json` on disk. We publish our own
numbers only: there is no submission process, and a PR that only edits this table's rows without
an accompanying `runs/<date>/` directory (results.jsonl + metrics.json + receipts/) will be
rejected. Anyone can reproduce a listed row by re-running the command above against the same
benchmark version and comparing `metrics.json`.
