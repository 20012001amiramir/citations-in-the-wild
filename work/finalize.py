#!/usr/bin/env python3
import io,sys,json,glob,hashlib,datetime,collections
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding="utf-8",errors="replace")

recs=[]; n=0; decisions=[]
for f in sorted(glob.glob("work/records/*.json")):
    d=json.load(open(f,encoding="utf-8")); dec=d["decision"]; decisions.append(dec)
    for kind in ("offending","controls"):
        for r in d.get(kind,[]):
            n+=1
            v=r["verdict_expected"]
            rec={
              "id": f"CITW-{n:04d}",
              "record_type": "offending" if kind=="offending" else "control",
              "verdict_expected": v,
              "checks_expected": {
                 "EXISTS": "FAIL" if v=="EXISTS_FAIL" else "PASS",
                 "SAYS":   "FAIL" if v=="SAYS_FAIL" else ("PASS" if v=="PASS" else "NOT_REACHED")
              },
              "finding": r.get("finding") if kind=="offending" else "verified_supporting_authority",
              "authority_type": r.get("authority_type","case"),
              "cited_authority": {
                 "as_cited": r["as_cited"],
                 "case_name": r.get("cited_case_name"),
                 "reporter_citation": r.get("reporter_citation"),
                 "court_year": r.get("court_year"),
                 "quoted_text": r.get("quoted_text"),
                 "cited_for": r.get("cited_for")
              },
              "offending_filing": r.get("filing"),
              "court_finding": {"quote": r["court_quote"], "locator": r.get("quote_locator")},
              "what_actually_exists": r.get("what_actually_exists"),
              "source_decision": {
                 "case_name": dec["case_name"], "court": dec["court"], "jurisdiction": dec["jurisdiction"],
                 "date": dec["date"], "docket": dec.get("docket"),
                 "neutral_citation": dec.get("neutral_citation"), "reported_as": dec.get("reported_as"),
                 "decision_url": dec["decision_url"], "mirror_url": dec.get("mirror_url"),
                 "retrieved_from": dec.get("retrieved_from"), "ai_tool_found": dec.get("ai_tool_found")
              }
            }
            recs.append(rec)

off=[r for r in recs if r["record_type"]=="offending"]
con=[r for r in recs if r["record_type"]=="control"]
cnt=collections.Counter(r["verdict_expected"] for r in recs)
fin=collections.Counter(r["finding"] for r in off)
jur=collections.Counter(r["source_decision"]["jurisdiction"] for r in recs)

doc={
 "name":"Citations in the Wild",
 "version":"v0",
 "generated":datetime.date.today().isoformat(),
 "purpose":"A seed benchmark for EXHIBIT B. Every record is a citation that a court has itself ruled on. Offending records are citations a court found fabricated, misquoted or misrepresented; control records are real citations from the same decisions that the court used and that say what they are cited for. A verifier that re-fetches each cited authority should reproduce verdict_expected.",
 "verdict_semantics":{
   "EXISTS_FAIL":"The cited authority does not resolve: no such case, or the reporter/neutral citation given belongs to a different case. The EXISTS check must fail; the SAYS check is not reached.",
   "SAYS_FAIL":"The cited authority resolves, but it does not contain the quoted text or does not support the proposition it was cited for. The EXISTS check passes; the SAYS check must fail.",
   "PASS":"The cited authority resolves and says what it is cited for. Both checks pass."
 },
 "finding_taxonomy":{
   "fabricated":"Court found no such authority exists.",
   "wrong_citation":"Court found the reporter/neutral citation given does not correspond to the named case (the name may or may not exist elsewhere).",
   "false_quote":"Court found the quoted words do not appear in the real authority.",
   "misrepresented":"Court found the real authority does not support the proposition it was cited for.",
   "verified_supporting_authority":"Control: the court itself relied on this authority for the stated proposition."
 },
 "counts":{
   "records_total":len(recs),
   "offending":len(off),
   "controls":len(con),
   "by_verdict":dict(cnt),
   "by_finding":dict(fin),
   "source_decisions":len(decisions),
   "by_jurisdiction":dict(jur)
 },
 "source_decisions":decisions,
 "records":recs
}
json.dump(doc, open("benchmark/citations-in-the-wild.v0.json","w",encoding="utf-8"), indent=1, ensure_ascii=False)
print(json.dumps(doc["counts"], indent=1, ensure_ascii=False))
