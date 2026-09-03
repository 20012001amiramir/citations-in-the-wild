# raw/ — harvest state

This directory holds the intermediate state of the harvest pipeline described in
[`../benchmark/README.md`](../benchmark/README.md) §2 and wrapped by
[`../work/`](../work/).

**Tracked here:**

- `candidates.json`, `candidates2.json` — CourtListener search results, keyed by cluster id, as
  written by `work/harvest.py` / `work/harvest2.py`. `candidates2.json` is the live/resumable
  state; re-running `harvest2.py` merges new results into it in place.
- `s1.json` — an earlier harvest snapshot, kept for provenance.

**Not tracked here, and git-ignored:** `raw/pdf/` and `raw/txt/` — the 225 fetched opinion PDFs
and their extracted text. They are large (tens of MB) and, more importantly, re-derivable: anyone
who clones this repo can regenerate them by running

```sh
pip install -r work/requirements.txt
python work/fetchdocs.py
```

from the repo root. `fetchdocs.py` reads `raw/candidates2.json`, fetches each opinion's PDF (or a
document url already on record), and extracts text with `pdftotext -layout`, falling back to
PyMuPDF when the layout extraction is too short. It skips anything already present in `raw/txt/`,
so it is safe to re-run.
