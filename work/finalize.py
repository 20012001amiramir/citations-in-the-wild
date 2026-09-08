import io,sys,json,glob,datetime,collections
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding="utf-8",errors="replace")

VERSION="v0.2"
OUT="benchmark/citations-in-the-wild.%s.json"%VERSION

def declared_checks(verdict,quoted_text):
    """The checks this record's own material can be scored on, read off that material.

    EXISTS is declared by every record: each one carries a citation string, which is the whole of
    what EXISTS needs. SAYS compares printed words against the authority's text, so it is declared
    only where the filing's quote is on the record. Where a court found a says-layer failure but
    never printed a checkable quote, what it found was that the authority does not hold what it
    was cited for -- HOLDS, a different check, and one an EXISTS/SAYS run cannot make. Nothing
    here is written per record."""
    if quoted_text and quoted_text.strip():
        return ["EXISTS","SAYS"]
    if verdict=="SAYS_FAIL":
        return ["EXISTS","HOLDS"]
    return ["EXISTS"]

recs=[]; decisions=[]
for f in sorted(glob.glob("work/records/*.json")):
    d=json.load(open(f,encoding="utf-8")); dec=d["decision"]; decisions.append(dec)
    for kind in ("offending","controls"):
        for r in d.get(kind,[]):
            v=r["verdict_expected"]
            a=r["as_cited"]
            completeness=("aggregate" if a.startswith("[Aggregate finding]")
                          else "partial" if r.get("partial_citation") else "full")
            rec={
              "id": r["id"],
              "record_type": "offending" if kind=="offending" else "control",
              "verdict_expected": v,
              "checks_expected": declared_checks(v,r.get("quoted_text")),
              "finding": r.get("finding") if kind=="offending" else "verified_supporting_authority",
              "authority_type": r.get("authority_type","case"),
              "citation_completeness": completeness,
              "cited_authority": {
                 "as_cited": a,
                 "case_name": r.get("cited_case_name"),
                 "reporter_citation": r.get("reporter_citation"),
                 "court_year": r.get("court_year"),
                 "quoted_text": r.get("quoted_text"),
                 "cited_for": r.get("cited_for")
              },
              "offending_filing": r.get("filing"),
              "court_finding": {"quote": r["court_quote"], "locator": r.get("quote_locator")},
              "what_actually_exists": r.get("what_actually_exists"),
              "record_note": r.get("note"),
              "source_decision": {
                 "case_name": dec["case_name"], "court": dec["court"], "jurisdiction": dec["jurisdiction"],
                 "date": dec["date"], "docket": dec.get("docket"),
                 "neutral_citation": dec.get("neutral_citation"), "reported_as": dec.get("reported_as"),
                 "decision_url": dec["decision_url"], "mirror_url": dec.get("mirror_url"),
                 "issuing_court_url": dec.get("issuing_court_url"), "fallback_url": dec.get("fallback_url"),
                 "url_check": dec.get("url_check"), "caption_note": dec.get("caption_note"),
                 "retrieved_from": dec.get("retrieved_from"), "ai_tool_found": dec.get("ai_tool_found")
              }
            }
            recs.append(rec)

ids=[r["id"] for r in recs]
assert len(set(ids))==len(ids), "duplicate record ids"

# checks_expected is derived, so what is asserted is the derivation holding over every record,
# not a hand-counted total that would rot the moment the corpus grows.
for r in recs:
    ck=r["checks_expected"]; q=r["cited_authority"]["quoted_text"]
    has_quote=bool(q and q.strip())
    assert ck[0]=="EXISTS", "%s: EXISTS must be declared first"%r["id"]
    assert len(ck)==len(set(ck)), "%s: duplicate check"%r["id"]
    assert ("SAYS" in ck)==has_quote, "%s: SAYS is declared iff a quote is on the record"%r["id"]
    assert ("HOLDS" in ck)==(not has_quote and r["verdict_expected"]=="SAYS_FAIL"), \
        "%s: HOLDS is declared iff a says-layer failure with no printed quote"%r["id"]

off=[r for r in recs if r["record_type"]=="offending"]
con=[r for r in recs if r["record_type"]=="control"]
cnt=collections.Counter(r["verdict_expected"] for r in recs)
fin=collections.Counter(r["finding"] for r in off)
jur=collections.Counter(r["source_decision"]["jurisdiction"] for r in recs)
comp=collections.Counter(r["citation_completeness"] for r in recs)
chk=collections.Counter("+".join(r["checks_expected"]) for r in recs)

scoreable_per_citation=sum(1 for r in recs if r["citation_completeness"]=="full")
scoreable_exists_says=sum(1 for r in recs
                          if r["citation_completeness"]=="full" and "HOLDS" not in r["checks_expected"])
assert sum(chk.values())==len(recs)
assert scoreable_exists_says<=scoreable_per_citation<=len(recs)

# The v0.2 corpus, frozen. Guarded on the record count so the weekly +100 recipe (benchmark
# README section 6) can grow the file without tripping over numbers that describe one release.
if len(recs)==225:
    assert dict(chk)=={"EXISTS":125,"EXISTS+SAYS":76,"EXISTS+HOLDS":24}, dict(chk)
    assert (scoreable_per_citation,scoreable_exists_says)==(219,197)

doc={
 "name":"Citations in the Wild",
 "version":VERSION,
 "generated":datetime.date.today().isoformat(),
 "changelog":"../CHANGELOG.md",
 "purpose":"A seed benchmark for EXHIBIT B. Every record is a citation that a court has itself ruled on. Offending records are citations a court found fabricated, misquoted or misrepresented; control records are real citations from the same decisions that the court used and that say what they are cited for. A verifier that re-fetches each cited authority should reproduce verdict_expected.",
 "verdict_semantics":{
   "EXISTS_FAIL":"The cited authority does not resolve: no such case, or the reporter/neutral citation given belongs to a different case. The EXISTS check must fail; the SAYS check is not reached.",
   "SAYS_FAIL":"The cited authority resolves, but it does not contain the quoted text or does not support the proposition it was cited for. The EXISTS check passes; the SAYS check must fail.",
   "PASS":"The cited authority resolves and says what it is cited for. Both checks pass."
 },
 "checks_expected_semantics":{
   "_":"Which checks a record's own material supports, derived from that material rather than declared uniformly. A verifier is scored on the checks a record declares and on no others: PASS when every declared check passed, EXISTS_FAIL or SAYS_FAIL when the matching check failed, INSUFFICIENT when a declared check could not run.",
   "EXISTS":"Declared by every record: the citation string is on the record, which is all EXISTS needs.",
   "SAYS":"Declared where cited_authority.quoted_text carries the words the filing put in the authority's mouth. Without a quote there is nothing to compare against, so SAYS is not declared and a SAYS verdict of NOT_RUN says nothing about the record.",
   "HOLDS":"Declared where the court found the authority does not hold what it was cited for but printed no checkable quote. That is a proposition-level judgement rather than a string comparison; an EXISTS/SAYS run cannot make it, so these records are excluded from EXISTS/SAYS scoring the way aggregate and partial records are excluded from per-citation scoring."
 },
 "finding_taxonomy":{
   "fabricated":"Court found no such authority exists, and did not identify any real authority behind the citation.",
   "wrong_citation":"Court found the reporter/neutral citation given does not correspond to the named case, and identified the real authority that occupies that reference or a real case of the same name.",
   "false_quote":"Court found the quoted words do not appear in the real authority.",
   "misrepresented":"Court found the real authority does not support the proposition it was cited for.",
   "verified_supporting_authority":"Control: the court itself relied on this authority for the stated proposition."
 },
 "citation_completeness_semantics":{
   "full":"The court printed a citation string a verifier can run an EXISTS check against.",
   "partial":"The court named the parties but did not reproduce the citation. Exclude from per-citation scoring.",
   "aggregate":"The court made a bulk finding without naming the individual citations. Exclude from per-citation scoring."
 },
 "counts":{
   "records_total":len(recs),
   "offending":len(off),
   "controls":len(con),
   "by_verdict":dict(cnt),
   "by_finding":dict(fin),
   "by_finding_note":"`fabricated` is used only where the court found nothing behind the citation. Where the court identified a real authority occupying the cited reference, or a real case of the same name, the record is `wrong_citation` even if the opinion's own prose calls the citation fake. v0 followed the courts' word choice and reported fabricated 69 / wrong_citation 7; 30 of those records were relabelled in v0.1. The verdicts (EXISTS_FAIL / SAYS_FAIL / PASS) are unchanged by the relabelling.",
   "by_citation_completeness":dict(comp),
   "by_declared_checks":dict(chk),
   "by_declared_checks_note":"v0 and v0.1 declared EXISTS and SAYS on every record, including the 149 carrying no quote for SAYS to read. The first live run scored every one of those INSUFFICIENT and so could not predict PASS at all. From v0.2 checks_expected is derived per record from the material that record carries. Nothing else moved: no id, quote, verdict or finding changed.",
   "scoreable_per_citation":scoreable_per_citation,
   "scoreable_exists_says":scoreable_exists_says,
   "scoreable_note":"`scoreable_per_citation` counts the records that name a citation of their own (citation_completeness `full`) -- the denominator for any per-citation score. `scoreable_exists_says` narrows that to the records an EXISTS/SAYS run can answer at all, dropping the ones whose only remaining declared check is HOLDS -- the denominator for a run of those two checks.",
   "source_decisions":len(decisions),
   "by_jurisdiction":dict(jur)
 },
 "source_decisions":decisions,
 "records":recs
}
# newline="\n" so what this writes is what is committed on any platform, and a second run
# reproduces the published file byte for byte rather than only after git's own normalisation.
json.dump(doc, open(OUT,"w",encoding="utf-8",newline="\n"), indent=1, ensure_ascii=False)
print("wrote", OUT)
print(json.dumps(doc["counts"], indent=1, ensure_ascii=False))
