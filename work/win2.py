#!/usr/bin/env python3
import io,sys,re
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding="utf-8",errors="replace")
TRIG = re.compile(r"(hallucinat|does not exist|do(es)? not exist|non-?existent|nonexistent|fictitious|fabricat|bogus|could not (be )?locate|no such case|not appear|does not stand for|does not support|do not support|misrepresent|misstat|phantom|made[- ]up|unable to (locate|find|verify)|false quot|says no such)", re.I)
CITE = re.compile(r"(v\.? [A-Z]|\d{2,4} [A-Z][A-Za-z.]*\s?\d|\bIL App\b|\bNY\d|\bWL \d)")
cid=sys.argv[1]; B=int(sys.argv[2]); A=int(sys.argv[3])
t=re.sub(r"[ \t]+"," ",open(f"raw/txt/{cid}.txt",encoding="utf-8",errors="replace").read())
t=re.sub(r"\n+"," ",t)
spans=[]
for m in TRIG.finditer(t):
    s,e=max(0,m.start()-B),min(len(t),m.end()+A)
    if spans and s<=spans[-1][1]: spans[-1]=(spans[-1][0],max(spans[-1][1],e))
    else: spans.append((s,e))
for i,(s,e) in enumerate(spans,1):
    seg=t[s:e]
    if not CITE.search(seg): continue
    print(f"\n--- W{i} ---\n{seg.strip()}")
