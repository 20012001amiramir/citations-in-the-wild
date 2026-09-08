# Citations in the Wild — CHANGELOG

*Benchmark entries only. The same review pass also revised four launch dossiers that live outside this repository, which is why the issue numbers below are not contiguous.*

## v0.1 — 2026-09-07

Applies all 21 issues raised in `AUDIT-v0.json`. Every fix was grounded by re-reading the primary
source the auditor named; no quotation was "improved", and where a court or a source used a
spelling, dash or hedge of its own, that form is now what the asset carries.

**Benchmark:** `benchmark/citations-in-the-wild.v0.json` → `benchmark/citations-in-the-wild.v0.1.json`
(223 → 225 records). Record ids are now **explicit and frozen** in `work/records/*.json` rather
than assigned positionally at build time, so the two new records could be added without
renumbering anything published. A v0 id means the same citation in v0.1.

---

### Benchmark

| # | Issue | What changed | File |
|---|---|---|---|
| 1 | CITW-0140 was unrunnable: `as_cited` held the placeholder `[unnamed Pennsylvania Superior Court case]` although the Alabama opinion prints the style | `as_cited` → `In re Estate of Domhoff, 217 A.3d 845, 853-54 (Pa. Super. Ct. 2019)`; `case_name` → `In re Estate of Domhoff`; `quoted_text` → the words the reply brief actually put in the case's mouth, `fell outside traditional contest statutes` | `work/records/008_ibach_al.json` → `benchmark/citations-in-the-wild.v0.1.json` |
| 2 | Zavadovsky docket was `1:25-cv-01234 (as reported by CourtListener)`, a number appearing nowhere in the record | docket → `1:25-cv-01008 (RC)` (the opinion reads "Civil Action No.: 25-1008 (RC)"); hedge dropped; `decision_url` → `https://ecf.dcd.uscourts.gov/cgi-bin/show_public_doc?2025cv1008-90` (200). Affects all 13 Zavadovsky records | `work/records/011_zavadovsky_ddc.json` |
| 3 | CITW-0187 silently corrected the court's own text | `as_cited`/`case_name` restored to the judgment's spelling **`Kohls v Elison`** (single l); the quote's em dash restored to the judgment's **en dash** (U+2013) in "relying too heavily on AI – in a case"; `...` restored to U+2026. The corrected US spelling moved into `what_actually_exists` | `work/records/010_ayinde_uk.json` |
| 4 | CITW-0139's `court_finding.quote` was elided to `a withdraw[n opinion] …`, breaching the README's own verbatim gate | full quote restored, including the court's `--` and its unbalanced parenthesis; `what_actually_exists` now names **State v. Laker**, its superseding citation, and IDC Rsch. v. Commissioner of Revenue | `work/records/008_ibach_al.json` |
| 5 | CITW-0142 had `what_actually_exists: null` although the court identified the real authority | populated from Ibach footnote 3, `See Hughes v. Glover, 53 Ill. App. 141 (1894)`, **and** the body text's "an 1893 Appellate Court of Illinois case". The opinion's 1893/1894 self-contradiction is recorded rather than silently reconciled; Bonvillian v. Klein recorded as the occupant of the Southern Reporter reference | `work/records/008_ibach_al.json` |
| 6 | CITW-0158 was `fabricated` while its own `what_actually_exists` named a real case at the reference | `finding` → `wrong_citation`. Shahid footnote 24 describes a parallel-citation mismatch (Miller v. State occupying 702 SE2d 888), not a nonexistent case | `work/records/009_shahid_ga.json` |
| 7 | `by_finding` was materially skewed: 33 of 69 `fabricated` records carried a `what_actually_exists` naming a real authority | **30 records relabelled `fabricated` → `wrong_citation`** (CITW-0018, 0048, 0056–0071, 0087, 0132, 0140–0144, 0147, 0152, 0158, 0177, 0203), on the rule that `fabricated` requires the court to have found *nothing* behind the citation. Counts recomputed: `fabricated` 69 → **41**, `wrong_citation` 7 → **37**. **No verdict changed.** `finding_taxonomy` rewritten to state the rule; `counts.by_finding_note` added; README headline and a new quality gate added. CITW-0147's truncated `what_actually_exists` ("30 N.E.3d 11x") replaced with the opinion's own two citations | `work/records/*.json`, `work/finalize.py`, `benchmark/README.md` |
| 8 | 7 of 13 `decision_url`s pointed at bot-blocked courtlistener.com; for 6 of them `decision_url == mirror_url`, so the mirror was inert — a re-fetchability failure in an asset about re-fetchability | Every decision now carries `decision_url` (verified **200** on 2026-09-07), `mirror_url` (CourtListener, recorded as answering 202 with a zero-byte challenge), `issuing_court_url`, optional `fallback_url`, and a `url_check` object with the date and per-URL result. Issuing-court URLs promoted where they work: **nebraska.gov** (Prososki), **ecf.dcd.uscourts.gov** (Zavadovsky), **nycourts.gov** (LeTennier, Landberg). Where the court's own link has rotted it is kept with its status and a durable `storage.courtlistener.com` PDF serves as `decision_url`: Shahid (efast.gaappeals.us **404**), Noland (courts.ca.gov **404**), Ibach (alappeals.gov **403**), Wilcox (public.courts.in.gov **timeout**) | all `work/records/*.json`, `benchmark/README.md` § 2 |
| 9 | Shahid omitted the two fabrications that reached the trial court's order — the ones that caused the vacatur | Two records added: **CITW-0224 (Epps)** and **CITW-0225 (Hodge)**, carrying footnote 24 verbatim ("…given in lieu of the bogus Epps and Hodge case citations from the superior court's order") plus the opinion's two corroborating passages. The opinion never prints their citations, so a new field **`citation_completeness`** (`full` / `partial` / `aggregate`) was added across the corpus and these two are `partial` — excluded from per-citation scoring, like the aggregates. `counts.scoreable_per_citation` = 219 | `work/records/009_shahid_ga.json`, `work/finalize.py`, `benchmark/README.md` § 1 |
| 10 | `reported_as` for Wilcox misspelled a party — a typo in a citation string inside a citation-accuracy benchmark | `Wilcox v. Gingrinch` → **`Wilcox v. Gingrich`**. Affects all 31 Wilcox records | `work/records/005_wilcox_in.json` |

**Consequential corrections found while implementing the above** (not raised in the audit, listed
for completeness): the README described "five aggregate records" where the file has always held
four; it now reports four `aggregate` plus the two new `partial` records against a stated
scoreable denominator. `finalize.py` now asserts id uniqueness and refuses duplicates.

---

---

### Verification run after the changes

- `benchmark/citations-in-the-wild.v0.1.json` parses. 225 records; **0** `verdict_expected` /
  `checks_expected` mismatches; **0** empty `court_finding.quote` or `locator`; **0** duplicate ids;
  **0** duplicate `(as_cited, quoted_text|cited_for, source_decision.case_name)` triples; **0** U+FFFD.
- All 13 `decision_url`s fetched: **13/13 200**. **0** `decision_url`s remain on
  `www.courtlistener.com`. Control ratio 1:2.21, inside the 1:2–1:4 gate.
- Sources re-fetched and re-read for this pass: the Ayinde judgment PDF (judiciary.uk), the Ibach
  and Shahid slip opinions.

---

## v0.1.1 — issue 8 closed — 2026-09-07

Closes the half-open half of audit issue 8 and the README contradiction the re-audit found next to
it. **No record, quote, verdict, finding or id changed**; the diff against the v0.1 JSON touches
exactly three fields, all inside `source_decision`, on four of thirteen decisions.

### The problem

All 13 `decision_url`s returned 200, but Wilcox, Ibach, Shahid and Noland had `fallback_url: null`
and exactly one working URL apiece — `storage.courtlistener.com`. That is the same operator, Free
Law Project, whose web front end `www.courtlistener.com` answers an automated fetch with a
zero-byte Cloudflare challenge. One operator is not re-fetchability.

### What was searched, and what was found

Each of the four was searched for an independent public copy — the issuing court's own site at its
*current* URL pattern, Justia, FindLaw, Leagle, CaseMine, Casetext, Google Scholar, and the Wayback
availability API against both the rotted issuing-court URL and the `storage.courtlistener.com` URL.
A copy counted only if it was fetched, returned **200**, and the case caption, docket number and
citations the records quote were found in the body. All four now have one:

| Decision | `fallback_url` found | Observed |
|---|---|---|
| **Wilcox v. Gingrich** (Ind. Ct. App., 25A-PL-1157) | `https://web.archive.org/web/20260315210643/https://public.courts.in.gov/Decisions/api/Document/Opinion?Id=C0b_…` | **200**, `application/pdf`, 227,101 B, 19 pp. Internet Archive capture (2026-03-15) of the issuing court's *own* document endpoint, taken while it still answered. Byte-for-byte the same size as the `storage.courtlistener.com` PDF. Caption "Steve Wilcox and Melissa Wilcox … v. Matthew A. Gingrinch and Grateful Home Exteriors, LLC", "Court of Appeals Case No. 25A-PL-1157", and the record citations *Reed v. State* and *Lacy v. State* all present |
| **Ibach v. Stewart** (Ala., SC-2025-0106) | `https://fingfx.thomsonreuters.com/gfx/legaldocs/znvnmqrwqpl/Alabama%20Supreme%20Court%20-%20AI.pdf` | **200**, `application/pdf`, 155,597 B, 54 pp. Reuters Legal's copy of the slip opinion — a live third-party operator, not an archive. Caption "SUPREME COURT OF ALABAMA … SC-2025-0106 … Laurie Ibach and Mark Stewart v. Bruce Stewart", and *Ex parte Helms*, *Janowiak*, *McFarland* and *Ex parte Segrest* all present |
| **Shahid v. Esaam** (Ga. Ct. App., A25A0196) | `https://web.archive.org/web/20250811111307/https://efast.gaappeals.us/download?filingId=79d42b0d…` | **200**, `application/pdf`, 117,377 B, 16 pp. Internet Archive capture (2025-08-11) of the issuing court's own eFAST download, taken before the link rotted. Same size as the `storage.courtlistener.com` PDF. Caption "In the Court of Appeals of Georgia — A25A0196. SHAHID v. ESAAM.", and *In the Interest of J. M. B.* and *Brown v. Brown* present |
| **Noland v. Land of the Free** (Cal. Ct. App., B331918) | `https://www4.courts.ca.gov/opinions/archive/B331918.PDF` | **200**, `application/pdf`, 225,786 B, 32 pp. The **issuing court itself**, at its current path: California moves published opinions from `/opinions/documents/` to `/opinions/archive/`, which is exactly why the recorded `issuing_court_url` 404s. Caption "SYLVIA NOLAND … v. LAND OF THE FREE, L.P. … B331918", "Filed 9/12/25 CERTIFIED FOR PUBLICATION", and *Schimmel*, *Regency* and the "Grok" admission present |

Each of the four now stands on two independent operators — Free Law Project plus, respectively,
the Internet Archive, Reuters, the Internet Archive, and, for Noland, the issuing court itself.
(`mirror_url` adds no operator; it is Free Law Project's own bot-blocked front end.)

### What was rejected, and why

Recorded here rather than left implicit, because the negative result is the substance of the issue:

- `law.justia.com` (all four), `caselaw.findlaw.com`, `leagle.com` and `casemine.com` (Shahid,
  Noland) return **403** to an automated fetch **even with a browser User-Agent**. That is the same
  failure mode as `www.courtlistener.com`, so none of them was recorded as a fallback.
- `public.courts.in.gov` (Wilcox) refuses to connect at all — the **whole host**, not just the
  document path, re-tested at a 180-second timeout, while `www.in.gov` answers 200 from the same
  network. The `url_check.issuing_court_url` note now says so.
- The Georgia Court of Appeals has moved from **gaappeals.us to gaappeals.gov**; the new domain
  answers **403** on every path tried, including the same `filingId`. The `url_check` note now
  records the move and the 403. So for Wilcox and Shahid the Internet Archive capture is the only
  independent copy of the court's own document a machine can still fetch.
- Two Westlaw/Lexis printouts on an unaffiliated S3 bucket (`websitedc.s3.amazonaws.com`) do return
  200 for Wilcox and Shahid, and a Berkeley Law PDF (364,427 B) returns 200 for Noland. None was
  recorded: the S3 copies have no identifiable operator or retention commitment, and the Berkeley
  PDF is a Westlaw reprint rather than the court's document. The captures chosen above are the
  court's own PDFs.
- `web.archive.org` was unreachable from this network during the v0.1 pass and **is reachable now**
  (200). Anyone re-running these checks should re-verify rather than assume.

### README fix (the second re-audit item)

§ 2 asserted "and CourtListener is now `mirror_url` only", which its own table contradicted. The
claim is now qualified to the front end and the storage host is stated plainly, matching the
language this CHANGELOG already used:

> … the per-decision result is recorded in `source_decision.url_check`, and `www.courtlistener.com`
> — the bot-blocked web front end — is now `mirror_url` only. That is a statement about the front
> end, not about the operator: four decisions (Wilcox, Ibach, Shahid, Noland) still take their
> `decision_url` from `storage.courtlistener.com`, the Free Law Project object store, because the
> issuing court's own link has rotted. As of **2026-09-07** each of those four also carries a
> `fallback_url` served by a different operator, so no decision in v0.1 depends on a single
> operator any more.

The § 2 re-fetchability table gained a `fallback_url` column; a second table lists the four copies
with their observed status; and the closing note records what was rejected and why, plus the
`web.archive.org` reachability caveat. The paragraph's "Two notes" is now "Three notes".

### Files changed

- `work/records/005_wilcox_in.json`, `008_ibach_al.json`, `009_shahid_ga.json`, `013_noland_ca.json`
  — `decision.fallback_url` set; `decision.url_check.fallback_url` added;
  `url_check.issuing_court_url` extended for Wilcox (host-level refusal) and Shahid (gaappeals.gov
  move). Nothing else touched.
- `benchmark/README.md` — § 2 only.
- `benchmark/citations-in-the-wild.v0.1.json` — regenerated by `work/finalize.py`.

### Verification run after the changes

- `benchmark/citations-in-the-wild.v0.1.json` parses. **225 records** (155 offending / 70 controls),
  13 source decisions, 12 jurisdictions — all unchanged from v0.1.
- Field-by-field diff of all 225 records against the v0.1 JSON: the **only** changed paths are
  `source_decision.fallback_url`, `source_decision.url_check.fallback_url` and
  `source_decision.url_check.issuing_court_url`. **0** changes to any quote, verdict, finding,
  locator or id.
- **0** `verdict_expected` / `checks_expected` mismatches; **0** empty `court_finding.quote` or
  `locator`; **0** duplicate ids; **0** duplicate
  `(as_cited, quoted_text|cited_for, source_decision.case_name)` triples; **0** U+FFFD.
- All 13 `decision_url`s re-fetched: **13/13 200**. All 5 `fallback_url`s fetched: **5/5 200**
  (the four new ones plus Prososki's). **0** `decision_url`s on `www.courtlistener.com`. **0**
  decisions left with a `storage.courtlistener.com` `decision_url` and no fallback. Control ratio
  1:2.21, inside the 1:2–1:4 gate.

## v0.1.2 — 2026-09-07
- Wilcox v. Gingrich: recorded the caption/body spelling discrepancy in the court PDF (caption "Gingrinch" once, body "Gingrich" seven times) as source_decision.caption_note; benchmark keeps the body spelling. No quotes, verdicts or ids changed.
