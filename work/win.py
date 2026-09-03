#!/usr/bin/env python3
import io,sys
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding="utf-8",errors="replace")
import re, sys
TRIG = re.compile(r"(hallucinat|does not exist|do(es)? not exist|non-?existent|nonexistent|fictitious|fabricat|bogus|could not (be )?locate|no such case|not appear|does not stand for|misrepresent|phantom|made[- ]up|unable to (locate|find|verify)|false quot|do not support)", re.I)
cid = sys.argv[1]; before = int(sys.argv[2]) if len(sys.argv)>2 else 400; after = int(sys.argv[3]) if len(sys.argv)>3 else 900
t = open(f"raw/txt/{cid}.txt", encoding="utf-8", errors="replace").read()
t = re.sub(r"[ \t]+", " ", t)
spans = []
for m in TRIG.finditer(t):
    s, e = max(0, m.start()-before), min(len(t), m.end()+after)
    if spans and s <= spans[-1][1]: spans[-1] = (spans[-1][0], max(spans[-1][1], e))
    else: spans.append((s, e))
for i,(s,e) in enumerate(spans,1):
    print(f"\n----- WINDOW {i} @ {s} -----")
    print(re.sub(r"\n{2,}", "\n", t[s:e]).strip())
