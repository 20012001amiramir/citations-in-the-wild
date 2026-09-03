#!/usr/bin/env python3
import io,sys,json,os,glob,hashlib
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding="utf-8",errors="replace")
recs=[]; n=0
files=sorted(glob.glob("work/records/*.json"))
for f in files:
    d=json.load(open(f,encoding="utf-8"))
    dec=d["decision"]
    for kind in ("offending","controls"):
        for r in d.get(kind,[]):
            n+=1
            rec={"id":f"CITW-{n:04d}","record_type":"offending" if kind=="offending" else "control",
                 "verdict_expected":r["verdict_expected"],
                 "finding":r.get("finding") if kind=="offending" else "verified_supporting_authority",
                 "authority_type":r.get("authority_type","case"),
                 "citation":{"as_cited":r["as_cited"],"case_name":r.get("cited_case_name"),
                             "reporter_citation":r.get("reporter_citation"),"court_year":r.get("court_year"),
                             "quoted_text":r.get("quoted_text")},
                 "cited_for":r.get("cited_for"),
                 "filing":r.get("filing"),
                 "court_finding":{"quote":r["court_quote"],"locator":r.get("quote_locator")},
                 "what_actually_exists":r.get("what_actually_exists"),
                 "decision":dec}
            recs.append(rec)
off=[r for r in recs if r["record_type"]=="offending"]; con=[r for r in recs if r["record_type"]=="control"]
print("decisions",len(files),"offending",len(off),"controls",len(con))
from collections import Counter
print(Counter(r["verdict_expected"] for r in recs))
print(Counter(r["finding"] for r in off))
json.dump(recs, open("work/merged.json","w",encoding="utf-8"), indent=1, ensure_ascii=False)
