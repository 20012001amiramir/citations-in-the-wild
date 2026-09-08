import io,sys,json,glob,datetime,collections
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding="utf-8",errors="replace")

VERSION="v0.1"
OUT="benchmark/citations-in-the-wild.%s.json"%VERSION

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
              "checks_expected": {
                 "EXISTS": "FAIL" if v=="EXISTS_FAIL" else "PASS",
                 "SAYS":   "FAIL" if v=="SAYS_FAIL" else ("PASS" if v=="PASS" else "NOT_REACHED")
              },
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

off=[r for r in recs if r["record_type"]=="offending"]
con=[r for r in recs if r["record_type"]=="control"]
cnt=collections.Counter(r["verdict_expected"] for r in recs)
fin=collections.Counter(r["finding"] for r in off)
jur=collections.Counter(r["source_decision"]["jurisdiction"] for r in recs)
comp=collections.Counter(r["citation_completeness"] for r in recs)

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
   "scoreable_per_citation":sum(1 for r in recs if r["citation_completeness"]=="full"),
   "source_decisions":len(decisions),
   "by_jurisdiction":dict(jur)
 },
 "source_decisions":decisions,
 "records":recs
}
json.dump(doc, open(OUT,"w",encoding="utf-8"), indent=1, ensure_ascii=False)
print("wrote", OUT)
print(json.dumps(doc["counts"], indent=1, ensure_ascii=False))
