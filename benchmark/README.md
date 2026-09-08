> This file documents the dataset only. For what this repo is, how to run the benchmark, and
> licensing, see [`../README.md`](../README.md).

# Citations in the Wild — v0.2

A seed benchmark of citations that courts have themselves ruled on: 155 offending citations a
court found fabricated, misquoted or misrepresented, and 70 control citations from the same
decisions that the court relied on and that say what they are cited for.

**File:** `citations-in-the-wild.v0.2.json` (225 records, 13 source decisions, 12 jurisdictions)
**Changes since v0 and v0.1:** `../CHANGELOG.md`

| | count |
|---|---|
| Records total | 225 |
| Offending | 155 |
| Controls | 70 |
| `EXISTS_FAIL` | 78 |
| `SAYS_FAIL` | 77 |
| `PASS` | 70 |
| Scoreable per citation | 219 |
| Scoreable on EXISTS/SAYS | 197 |
| Source decisions | 13 |

Findings among offending records: `misrepresented` 42, `fabricated` 41, `wrong_citation` 37,
`false_quote` 35.

`fabricated` and `wrong_citation` are not the courts' vocabulary, they are this benchmark's. A
court routinely writes "that case does not exist" and then, in the next sentence, names the real
authority sitting at the reporter reference the filing gave. v0 followed the courts' word choice
and published `fabricated` 69 / `wrong_citation` 7. That headline was wrong for the taxonomy it
was labelled with: 30 of those 69 records carried a `what_actually_exists` naming a real
authority. They are `wrong_citation` in v0.1. **No verdict changed** — a citation that resolves
to a different case still fails EXISTS.

---

## 1. What each record is

One record = one citation, as it appeared in a filing, plus the court's own verbatim finding about it.

```jsonc
{
  "id": "CITW-0001",
  "record_type": "offending",          // or "control"
  "verdict_expected": "EXISTS_FAIL",   // EXISTS_FAIL | SAYS_FAIL | PASS
  "checks_expected": ["EXISTS"],       // what this record's material supports — see § 1
  "finding": "fabricated",
  "authority_type": "case",            // case | statute | court_rule
  "citation_completeness": "full",     // full | partial | aggregate — see § 1
  "cited_authority": {
    "as_cited": "Eduardo v. Garland, 28 F.4th 742 (9th Cir. 2022)",
    "case_name": "Eduardo v. Garland",
    "reporter_citation": "28 F.4th 742",
    "court_year": "9th Cir. 2022",
    "quoted_text": null,               // the words the filing put in the authority's mouth
    "cited_for": null                  // controls: the proposition the court used it for
  },
  "offending_filing": "Petitioners' opening brief, Lnu v. Blanche, No. 24-4790",
  "court_finding": {
    "quote": "Sethi cited two cases that do not exist and never existed: …",
    "locator": "slip op. at 6"
  },
  "what_actually_exists": "Nothing under this name. Counsel's Motion to Correct sought to …",
  "record_note": null,                 // set where a record needs its own caveat
  "source_decision": {
    "case_name": "…", "court": "…", "docket": "…",
    "decision_url": "…",               // 200 as of url_check.checked
    "mirror_url": "…",                 // CourtListener cluster page
    "issuing_court_url": "…",          // the court's own link, recorded even when it 404s
    "fallback_url": null,              // a third copy, where one was needed
    "url_check": { "checked": "2026-09-07", "decision_url": "200", … },
    …
  }
}
```

Records are ordered by source decision, then offending, then controls. Ids are stable across
versions, so once a record is added mid-file the id sequence is no longer strictly ascending in
document order — sort by `id` if you need that. Never renumber; a v0 id means the same citation
in v0.1.

### Verdict semantics

EXHIBIT B runs two checks on every cited source: **EXISTS** (the source resolves) and **SAYS**
(it says what is quoted). The benchmark's verdicts map onto them directly:

- **`EXISTS_FAIL`** — the authority does not resolve. Either no such case exists, or the
  reporter/neutral citation given belongs to a different case. EXISTS must fail; SAYS is never
  reached.
- **`SAYS_FAIL`** — the authority resolves, but it does not contain the quoted words, or does not
  support the proposition it was cited for. EXISTS must pass; SAYS must fail.
- **`PASS`** — the authority resolves and says what it is cited for. Both checks pass. These are
  the controls, and they exist so that a verifier which simply fails everything scores 0, not 68 %.

`wrong_citation` is scored `EXISTS_FAIL` deliberately: the case name may exist somewhere, but the
citation string handed to the verifier does not resolve to it. That is the failure mode a
re-fetching system actually encounters. The split between `fabricated` and `wrong_citation` is a
statement about what the court found *behind* the citation, never about the verdict.

### Declared checks

`checks_expected` lists the checks a record's own material supports. It is derived from that
material, never written per record, and it is not a restatement of the verdict. A verifier is
scored on the checks a record declares and on no others: `PASS` when every declared check passed,
`EXISTS_FAIL` or `SAYS_FAIL` when the matching check failed, `INSUFFICIENT` when a declared check
could not run. Across the 225 records:

- **`["EXISTS"]`** (125 records) — no quote is on the record, so there is nothing for SAYS to
  compare and nothing is asked of it. A resolve is the whole question. The 70 controls are here,
  together with 55 offending records whose failure is that the citation does not resolve at all.
- **`["EXISTS","SAYS"]`** (76 records) — `cited_authority.quoted_text` carries the words the filing
  put in the authority's mouth. Both checks are answerable, so both are asked.
- **`["EXISTS","HOLDS"]`** (24 records) — the court found the authority does not hold what it was
  cited for, and printed no quote to check that against. HOLDS is a judgement about a proposition
  rather than a comparison of strings, and an EXISTS/SAYS run cannot make it.

Two denominators follow from this, and they are not the same number:

- **`counts.scoreable_per_citation`** (219) — the records that name a citation of their own, which
  is everything except the `aggregate` and `partial` records described next. Use it for any score
  computed citation by citation.
- **`counts.scoreable_exists_says`** (197) — that set less the 22 `full` records whose only
  remaining check is HOLDS. Use it for a run of EXISTS and SAYS; it is what `lib/score.mjs`'s
  `dropUnscoreable` keeps.

v0 and v0.1 declared EXISTS and SAYS on every record, including the 149 carrying no quote. A
verifier that resolved a control and then — correctly — never ran SAYS on it was scored
`INSUFFICIENT`, so no record in the file could be predicted `PASS` at all. What was wrong was the
declaration, not the records: no id, quote, verdict or finding changed in v0.2.

### Citation completeness

`citation_completeness` says whether the record carries something a verifier can actually run:

- **`full`** (219 records) — the court printed a citation string. Score these.
- **`aggregate`** (4 records) — the court made a bulk finding ("eighteen of forty-five citations
  do not exist") without naming the individual citations. Flagged in `as_cited` with the
  `[Aggregate finding]` prefix.
- **`partial`** (2 records) — the court named the parties but never reproduced the citation.
  Both are in *Shahid v. Esaam*: the **Epps** and **Hodge** citations that reached the superior
  court's own order and caused it to be vacated. They are the most consequential fabrications in
  that case and belong in the corpus; they are flagged with the `[Partial citation]` prefix.

Exclude `aggregate` and `partial` when scoring a verifier per citation — `counts.scoreable_per_citation`
is the denominator to use. For a run of EXISTS and SAYS specifically, exclude the `["EXISTS","HOLDS"]`
records as well and use `counts.scoreable_exists_says`.

---

## 2. Provenance

Every record was extracted by reading the published text of the decision itself. Nothing was
taken from a secondary summary, and nothing was inferred.

### Source decisions

| Decision | Court | Date | Records |
|---|---|---|---|
| Lnu v. Blanche, No. 24-4790 | US Court of Appeals, 9th Cir. | 2026-06-03 | 17 |
| Scott v. Illinois Human Rights Comm'n, 1-25-1462 | Appellate Court of Illinois, 1st Dist. | 2026-07-28 | 17 |
| Barber v. Morawa, 374773 | Michigan Court of Appeals | 2026-06-17 | 12 |
| Landberg v. City of New York, 2025-02380 | NY App. Div., 2d Dep't | 2026-06-23 | 9 |
| Wilcox v. Gingrich, 25A-PL-1157 | Court of Appeals of Indiana | 2026-01-30 | 31 |
| Prososki v. Regan, 321 Neb. 38 | Nebraska Supreme Court | 2026-03-20 | 28 |
| Capital Standard, LLC v. U.S. Bank N.A., 2D2024-1392 | Florida 2d DCA | 2026-08-21 | 14 |
| Ibach v. Stewart, SC-2025-0106 | Supreme Court of Alabama | 2026-04-24 | 28 |
| Shahid v. Esaam, A25A0196 | Court of Appeals of Georgia | 2025-06-30 | 22 |
| R (Ayinde) v Haringey; Al-Haroun v QNB, [2025] EWHC 1383 (Admin) | High Court (Div. Ct.), England & Wales | 2025-06-06 | 13 |
| Zavadovsky v. Republic of Austria, 1:25-cv-01008 (RC) | US District Court, D.D.C. | 2026-03-31 | 13 |
| Deutsche Bank Nat'l Trust Co. v. LeTennier | NY App. Div., 3d Dep't | 2026-01-08 | 7 |
| Noland v. Land of the Free, L.P., 114 Cal. App. 5th 426 | California Court of Appeal, 2d Dist. | 2025-09-12 | 14 |

### Re-fetchability of the source decisions

A benchmark about re-fetching has to be re-fetchable itself. In v0, 7 of the 13 `decision_url`
values pointed at courtlistener.com, and for 6 of those `decision_url == mirror_url`, so there was
no working fallback at all: courtlistener.com answers an automated fetch with **HTTP 202 and a
zero-byte Cloudflare challenge**, and the v4 API answers 401. In v0.1 every `decision_url` was
fetched and returned 200 on **2026-09-07**; the per-decision result is recorded in
`source_decision.url_check`, and `www.courtlistener.com` — the bot-blocked web front end — is
now `mirror_url` only. That is a statement about the front end, not about the operator: four
decisions (Wilcox, Ibach, Shahid, Noland) still take their `decision_url` from
`storage.courtlistener.com`, the Free Law Project object store, because the issuing court's own
link has rotted. As of **2026-09-07** each of those four also carries a `fallback_url` served by a
different operator, so no decision in v0.1 depends on a single operator any more.

Where the issuing court's own link works, it *is* `decision_url`. Where it has rotted, the record
says so rather than quietly substituting a copy:

| Decision | `decision_url` (200) | `issuing_court_url` | `fallback_url` (200) |
|---|---|---|---|
| Lnu v. Blanche | cdn.ca9.uscourts.gov | 200 | — |
| Scott v. Ill. Human Rights Comm'n | illinoiscourts.gov | 200 | — |
| Barber v. Morawa | courts.michigan.gov | 200 | — |
| Landberg v. City of New York | nycourts.gov | 200 | — |
| Prososki v. Regan | nebraska.gov (`docId=N00013081PUB`) | 200 | storage.courtlistener.com |
| Capital Standard v. U.S. Bank | flcourts-media.flcourts.gov | 200 | — |
| R (Ayinde) v Haringey | judiciary.uk | 200 | — |
| Zavadovsky v. Republic of Austria | ecf.dcd.uscourts.gov | 200 | — |
| Deutsche Bank v. LeTennier | nycourts.gov | 200 | — |
| **Wilcox v. Gingrich** | storage.courtlistener.com | public.courts.in.gov — **times out** | web.archive.org snapshot of public.courts.in.gov |
| **Ibach v. Stewart** | storage.courtlistener.com | alappeals.gov — **403** | fingfx.thomsonreuters.com |
| **Shahid v. Esaam** | storage.courtlistener.com | efast.gaappeals.us — **404** | web.archive.org snapshot of efast.gaappeals.us |
| **Noland v. Land of the Free** | storage.courtlistener.com | courts.ca.gov — **404** | www4.courts.ca.gov/opinions/**archive**/ |

`storage.courtlistener.com` is the object store, not the bot-blocked web front end, and it serves
the same slip-opinion PDFs at 200. But one working URL from one operator is not re-fetchability,
so the four decisions above were re-searched on **2026-09-07** for an independent third copy. Each
copy below was fetched, returned **200** with `application/pdf`, and was verified by finding the
case caption and docket number in the body along with citations the records quote:

| Decision | Third copy (`fallback_url`) | Result |
|---|---|---|
| Wilcox v. Gingrich | `web.archive.org/web/20260315210643/https://public.courts.in.gov/Decisions/api/Document/Opinion?Id=C0b_…` | 200, 19 pp. — the Internet Archive's 2026-03-15 capture of the issuing court's *own* document endpoint, taken while it still answered |
| Ibach v. Stewart | `fingfx.thomsonreuters.com/gfx/legaldocs/znvnmqrwqpl/Alabama Supreme Court - AI.pdf` | 200, 54 pp. — Reuters Legal's copy of the slip opinion |
| Shahid v. Esaam | `web.archive.org/web/20250811111307/https://efast.gaappeals.us/download?filingId=79d42b0d…` | 200, 16 pp. — the Internet Archive's 2025-08-11 capture of the issuing court's own eFAST download, taken before the link rotted |
| Noland v. Land of the Free | `www4.courts.ca.gov/opinions/archive/B331918.PDF` | 200, 32 pp. — the issuing court's own current path; California moves published opinions from `/opinions/documents/` to `/opinions/archive/`, which is why the recorded `issuing_court_url` 404s |

Each of the four now stands on two independent operators: Free Law Project plus, respectively, the
Internet Archive, Reuters, the Internet Archive, and — for Noland — the issuing court itself.
(`mirror_url` does not add an operator; it is Free Law Project's own bot-blocked front end.) What
was *not* found matters too: for all four, the aggregator
copies — `law.justia.com`, `caselaw.findlaw.com`, `leagle.com`, `casemine.com` — answer **403** to
an automated fetch even with a browser User-Agent, which is the same failure mode as
`www.courtlistener.com` and is why none of them is recorded here. `public.courts.in.gov` refuses
to connect at all (the whole host, not just the document path, re-tested at a 180-second timeout),
and the Georgia Court of Appeals has since moved to `gaappeals.gov`, which answers **403** on
every path including the same `filingId` — so for Wilcox and Shahid the Internet Archive capture
is the only independent copy of the court's own document that a machine can still fetch.

Three notes for anyone re-running these checks: nycourts.gov returns 403 to a default `curl`
User-Agent and 200 to a browser one; `web.archive.org` was unreachable from this network during
the earlier v0.1 pass and is reachable now, so a `fallback_url` on it should be re-checked rather
than assumed; and four of thirteen issuing-court links have already rotted inside a year — which
is the phenomenon this whole asset exists to make legible.

### How the corpus was found

1. **CourtListener's public search API** (`/api/rest/v4/search/`, anonymous, rate-limited) was
   queried with 24 phrase searches — `"hallucinated" "citations"`, `"non-existent cases" citation`,
   `"fabricated citations"`, `"quotations that do not appear"`, `"does not stand for the
   proposition" "artificial intelligence"`, and so on — yielding 286 candidate opinion clusters.
2. Each cluster's opinion document was fetched from `storage.courtlistener.com` or the issuing
   court's own server, and converted to text with `pdftotext -layout` (falling back to PyMuPDF).
   188 usable texts were obtained.
3. The texts were triaged by counting distinct citation strings appearing within ±350 characters
   of a hallucination-finding trigger phrase — this separates decisions that *itemise* the bad
   citations from decisions that merely mention that some existed.
4. The top-scoring decisions were read in full, and records were transcribed by hand from the
   opinion text.

For **Prososki v. Regan**, the court's citation chart is a two-column table that `pdftotext`
reflows incorrectly, silently mis-pairing citations with findings. That table was re-extracted
from the PDF using per-word coordinates (PyMuPDF `get_text("words")`) so that each citation is
paired with the finding actually printed beside it. This mattered: a naive extraction attributed
"Does not support cited proposition" to the wrong three cases.

Scripts live in `../work/` (`harvest2.py`, `fetchdocs.py`, `triage2.py`, `win2.py`,
`finalize.py`). Raw PDFs and extracted text are in `../raw/`.

---

## 3. Licence

**The underlying decisions are public record.** US federal and state judicial opinions are not
subject to copyright — under the government edicts doctrine, works that judges create in their
official capacity are uncopyrightable (*Banks v. Manchester*, 128 U.S. 244 (1888); *Georgia v.
Public.Resource.Org*, 590 U.S. 255 (2020)). The English judgment is published by the Courts and
Tribunals Judiciary as an Approved Judgment for public use.

What this benchmark adds on top of that public record is: selection, per-citation segmentation,
the verdict labels, and the structured schema. Those are ours to license; suggested terms are
CC BY 4.0 with attribution to the source decision preserved in every record.

Every `court_finding.quote` is a verbatim excerpt of a judicial opinion, kept short and cited to a
locator, so that any reader can go to `decision_url` and confirm it. The one structured exception
is the 20 chart-derived quotes from *Prososki v. Regan* — see limit 9.

---

## 4. What was not used, and why

**Damien Charlotin's AI Hallucination Cases database** (https://www.damiencharlotin.com/hallucinations/)
is the canonical index of these cases — roughly 1,700 decisions worldwide as of mid-2026, faceted
by jurisdiction, party type, AI tool and outcome. It is cited by courts, including by the Florida
Second District in one of our own source decisions.

**We did not scrape it.** `damiencharlotin.com/robots.txt` serves
`Content-Signal: search=yes, ai-train=no, use=reference` for all agents and an explicit
`User-agent: ClaudeBot / Disallow: /`. Automated retrieval by this agent is not permitted, so the
database was used only as a pointer confirmed through published third-party reporting, and every
record here was built from the decision texts instead.

The same block applies to the non-US equivalents:

| Source | Status |
|---|---|
| AustLII (austlii.edu.au) | `ClaudeBot: Disallow: /` — not fetched |
| Find Case Law (caselaw.nationalarchives.gov.uk) | `ClaudeBot`, `anthropic-ai`, `Claude-Web`: `Disallow: /` — not fetched |
| BAILII (bailii.org) | `User-agent: *` disallows `/ew`, `/uk`, `/scot`, etc. — not fetched |
| CanLII (canlii.org) | `User-agent: *  Disallow: /` — not fetched |
| Courts and Tribunals Judiciary (judiciary.uk) | `User-agent: *  Disallow:` (all permitted) — **fetched** |
| CourtListener API + storage | public API, anonymous access permitted — **fetched** |

So: **all 212 US records and 13 UK records came from sources that permit automated access.**
Australian and Canadian decisions are documented in section 6 as the first extension target, with
a manual retrieval path, because the hosts that carry them block this agent.

---

## 5. Known limits

1. **US-heavy.** 12 of 13 source decisions are US; one is English. No Australian, Canadian, Irish,
   Indian or continental European records yet. This is a robots.txt consequence, not a judgement
   about where the problem lives — Australia in particular has a large documented caseload.
2. **Selection bias toward itemising courts.** The triage deliberately favours decisions that list
   the offending citations one by one. Courts that write "the brief cited two cases that do not
   exist" without naming them (e.g. *Dineen/Shibata v. Kotchka*, Ariz. Ct. App. 2026) contribute
   nothing, even though they are part of the phenomenon. The benchmark therefore over-represents
   long, careful, sanctions-focused opinions.
3. **Appellate skew.** Trial-court orders are less often published in full text, so the corpus
   skews appellate. Pro se filings are represented (Wilcox, Zavadovsky, Shahid's underlying
   response) but under-represented relative to their share of the population.
4. **Recency skew.** Most source decisions are from 2025–2026, when courts began writing about
   this systematically. Earlier incidents (Mata v. Avianca, 2023) appear here only as controls.
5. **The court's finding is the ground truth, not an independent re-fetch.** A record labelled
   `EXISTS_FAIL` is one a court said does not exist. We did not independently re-verify each
   citation against a reporter database. In a handful of cases a court says a case "appears not to
   exist" or "does not appear to exist" — hedged language that is preserved verbatim in
   `court_finding.quote`. Treat those as high-confidence, not certain.
6. **Controls are not adversarial.** Control citations are authorities the court itself used, so
   they are unusually clean: correctly formatted, correctly pin-cited, squarely on point. Real
   filings contain harder negatives — slightly wrong pin cites, subsequent history omitted,
   authorities that support a proposition only partly. v1 should add a *hard control* class.
7. **Six records are not scoreable per citation, and 22 more are not scoreable on EXISTS/SAYS** —
   four `aggregate` (a court's bulk finding, no individual citations named) and two `partial` (the
   *Shahid* Epps and Hodge citations, where the court names the parties but never prints the
   citations); both are flagged in `citation_completeness` and prefixed in `as_cited`. Filter them
   out when scoring and use `counts.scoreable_per_citation` = 219. On top of that, 22 `full`
   records declare `["EXISTS","HOLDS"]` — the court found a says-layer failure without printing a
   quote — which an EXISTS/SAYS run cannot answer either way; for such a run use
   `counts.scoreable_exists_says` = 197. *(v0's README said five aggregates; the file has always
   held four.)*
8. **Quotation fidelity.** `court_finding.quote` is transcribed from PDF text extraction. Curly
   quotes and ellipses have been normalised to the source's own forms where the extractor rendered
   them imperfectly, and those passages were repaired by hand against the layout text. Locators
   are the court's own (paragraph number, slip-op page, or reporter page).
   **Dashes and spellings are not normalised.** A quote reproduces the codepoint the court used —
   the Alabama opinion's `--`, the English judgment's `–` — and a citation reproduces the court's
   own spelling of a party, including where it is wrong (the *Ayinde* judgment writes
   "Kohls v Elison"; the corrected form lives in `what_actually_exists`, never in `as_cited`).
   An asset that silently improves a court's text cannot be used to test whether anyone else does.
9. **Chart-derived quotes.** The 20 records from *Prososki v. Regan* quote a two-column table.
   Their `court_finding.quote` is prefixed `Chart:` and reproduces the citation and the bullets
   printed beside it, joined with `•` — faithful to the table, but not a single contiguous run of
   text in the opinion. `locator` says `(chart)` for each. A verbatim-substring check against
   extracted PDF text will not match these, by design.
10. **No filing-level provenance.** Records cite the offending *filing* by name but do not link to
   the filing itself. Where the brief is on PACER/RECAP, a v1 record could carry the document link
   and the exact page.

---

## 6. How to extend by 100 records per week

The pipeline is already reproducible; extension is a matter of turning the crank on new decisions
and reading them. Budget roughly 6–8 hours per 100 records.

**Weekly loop**

1. **Re-harvest.** `python work/harvest2.py` re-runs the 24 phrase queries against CourtListener,
   newest first, and merges into `raw/candidates2.json` (resumable, so it only adds). At the
   observed rate of new AI-hallucination decisions — roughly 5–8 published per day worldwide — a
   week yields 35–55 fresh candidate decisions.
2. **Fetch and extract.** `python work/fetchdocs.py` pulls each new opinion PDF and writes text.
   It skips anything already extracted.
3. **Triage.** `python work/triage2.py` ranks new decisions by the number of distinct citation
   strings sitting next to a finding phrase. Work strictly down that ranking. A decision scoring
   ≥ 10 typically yields 8–20 records; one scoring ≤ 4 usually yields none.
4. **Read and transcribe.** `python work/win2.py <cluster_id> 180 500` prints only the passages
   that contain both a finding phrase and a citation. Transcribe each citation into a new
   `work/records/NNN_<slug>.json` following the existing files' shape. **Rule: if the court did
   not name the citation, do not create a record for it.**
5. **Harvest controls while you are there.** Every decision you read is full of real authorities
   the court itself relied on. Take 3–6 per decision; that keeps the control ratio near 1:3 without
   extra reading. Prefer controls where the court quotes the authority — those exercise the SAYS
   check, not just EXISTS.
6. **Rebuild.** `python work/finalize.py` regenerates
   `benchmark/citations-in-the-wild.<VERSION>.json` and prints the counts. Give every new record
   an explicit `id` continuing the sequence — `finalize.py` reads ids from the record files and
   refuses duplicates, so an insertion never renumbers what is already published. Bump `VERSION`
   in `finalize.py` and add a `CHANGELOG.md` entry when the record count or any published count
   changes.

**Two-column tables.** Any decision that presents its findings as a table needs the coordinate
extraction used for Prososki, not `pdftotext`. The snippet is in this repo's history; the check is
simple — if a table's rows have unequal bullet counts, the reflow has scrambled it.

**Getting past 100/week, and getting non-US coverage**

- **Widen the query set.** The 24 phrases used here are not exhaustive. Add
  `"citations that do not exist"`, `"cite check"`, `"show cause"` + `"artificial intelligence"`,
  `"Rule 3.3"` + `hallucinat*`, and non-English equivalents. Each new phrase that lands typically
  surfaces 5–20 decisions the others missed.
- **Mine the citation graphs.** Every decision in this benchmark cites 5–15 others addressing the
  same problem (see the control records — *Whiting*, *Fletcher*, *Johnson v. Dunn*, *McGee*,
  *Kruse*, *Garner*, *In re Kenney*, *Versant*, *Hall v. Academy Charter School*, *Powhatan*,
  *Schoene*, *In re Richburg*, *Lee v. R&R Home Care*, *Malone-Bey*, *Amarsingh*, *Heimkes*,
  *Grymes*, *Cojom*, *Ader*, *In re Kheir*, *Matter of Samuel*, *Baby Boy*, *In re S.M.*,
  *In re A.S.*, *Pletcher*, *Al-Hamim*, *Dukuray*, *Williams v. Kirch*, *Mid Central v.
  HoosierVac*, *Nixon*, *Wadsworth*, *Benjamin*, *Hardy v. Whitaker*, *Gauthier*, *Jackson v.
  Auto-Owners*, *Ringo*, *Rangel*, *Russell v. Mells*, *Hessert*, *Gouveia*, *Goya*, *Takefman*,
  *Gutierrez*, *Gleason*, *Rodriguez*, *Avery v. Beauzil*). That list alone is a month of work
  and it is already in the file. Resolve each by name in CourtListener, fetch, triage, read.
- **Australia and Canada.** AustLII and CanLII block this agent, so those records must come from
  a permitted path: a human retrieving the judgment, an AustLII/CanLII API licence, or the issuing
  court's own site where its robots.txt allows it. A ready worklist of Australian matters —
  *Valu v Minister for Immigration (No 2)* [2025] FedCFamC2G 95, *DPP v GR* [2025] VSC 490,
  *Re Walker* [2025] VSC 714, *Khoury v Kooij* [2025] QSC 217, *Tekla & Tekla*
  [2025] FedCFamC1A 245, *Mertz & Mertz (No 3)* [2025] FedCFamC1A 222, *Handa & Mallick*
  [2024] FedCFamC2F 957, *Re Dayal* (2024) 386 FLR 359 — and Canadian ones — *Zhang v Chen*,
  2024 BCSC 285, *Ko v Li*, 2025 ONSC 2965 — is the obvious first 100 once a lawful retrieval
  path is in place.
- **Do not scrape the aggregator databases.** They are the right place to *find* case names. They
  are not a permitted place to bulk-collect from. Use them the way this file did: as a pointer,
  then go to the decision.

**Quality gates before merging a week's batch**

- Every record has a non-empty `court_finding.quote` that is verbatim from the decision —
  contiguous, unelided, and carrying the court's own dashes, quotation marks and spellings. A
  bracketed elision inside a quote is a defect, not a tidy-up.
- Every record has a `court_finding.locator` a reader can navigate to.
- Every record has an `id`, unique across the whole corpus and never reused or reassigned.
- Every `source_decision.decision_url` was fetched and returned 200, and the result is written to
  `url_check` with the date. If the issuing court's own link failed, it stays in
  `issuing_court_url` with its status — never deleted, never silently replaced.
- `verdict_expected` is `EXISTS_FAIL` only where the court said the authority or its citation does
  not resolve — not merely that it was unhelpful.
- A record is `fabricated` only if the court identified nothing behind the citation. If the
  opinion names a real authority at the cited reference, or a real case of the same name, the
  record is `wrong_citation`, whatever adjective the opinion used.
- No record carries a bracketed placeholder in `as_cited` where the court printed a case style.
  Placeholders are reserved for `aggregate` and `partial` records and must be flagged in
  `citation_completeness`.
- `quoted_text` holds the filing's quote where the court printed one, and `null` where it did not.
  Never a paraphrase, and never the court's own words about the citation — `checks_expected` is
  derived from this field, so a quote invented to fill it declares a SAYS check with nothing
  behind it, which is the defect v0.2 fixed.
- No two records share the same `(as_cited, quoted_text or cited_for, source_decision.case_name)`
  triple. The same authority legitimately appears twice in one decision when it was cited for two
  different false propositions — there are three such pairs in v0, all in *Capital Standard*.
- Control ratio stays between 1:2 and 1:4 against offending records.
