# LEADERBOARD

Dated runs of `run.mjs` against citations-in-the-wild, scored per [`lib/score.mjs`](lib/score.mjs).
This table lists **our own runs only** — see [`README.md`](README.md) for what each column means
and why we don't accept third-party-submitted numbers.

| Date | n | Balanced accuracy | EXISTS P/R | SAYS match | INSUFFICIENT share | Partial |
|---|---|---|---|---|---|---|
| 2026-09-08 | 219 | 0.451 | 0.679 / 0.514 | 0.271 | 54.3% | no |

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
