#!/usr/bin/env python3
import io,sys,json,os,re
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding="utf-8",errors="replace")
TRIG=re.compile(r"(hallucinat|does not exist|do not exist|non-?existent|nonexistent|fictitious|fabricat|bogus|no such case|does not appear|do not appear|does not stand for|does not support|do not support|says no such|not contain the|could not (be )?locate|unable to (locate|find))",re.I)
CITE=re.compile(r"[A-Z][A-Za-z.'’\-]{2,}(?: [A-Za-z.'’\-]+){0,5},? v\.? [A-Z][A-Za-z.'’\-]{2,}[^,\n]{0,40},\s*(?:\d+[^,\n]{0,30}\d|\d{4} [A-Z]{2,}[^,\n]{0,25})")
cands=json.load(open("raw/candidates2.json")); bc={str(v["cluster_id"]):v for v in cands.values()}
rows=[]
for fn in os.listdir("raw/txt"):
    cid=fn[:-4]; t=re.sub(r"\s+"," ",open("raw/txt/"+fn,encoding="utf-8",errors="replace").read())
    named=set()
    for m in TRIG.finditer(t):
        for c in CITE.finditer(t[max(0,m.start()-350):m.end()+450]): named.add(c.group(0)[:70])
    m=bc.get(cid,{})
    rows.append((len(named),cid,(m.get("dateFiled") or "?"),(m.get("court") or "?")[:30],(m.get("caseName") or "?")[:48]))
rows.sort(reverse=True)
for r in rows[:70]: print(f"{r[0]:3d}  {r[1]}  {r[2]}  {r[3]:<30} {r[4]}")
print("files",len(rows))
