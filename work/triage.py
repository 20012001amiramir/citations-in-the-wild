#!/usr/bin/env python3
import json, os, re, sys

TRIG = re.compile(r"(hallucinat|does not exist|do not exist|non-?existent|nonexistent|fictitious|fabricat|bogus|could not (be )?locate|no such case|not appear in|does not stand for|misrepresent|phantom|made[- ]up|unable to (locate|find|verify)|false quot)", re.I)
cands = json.load(open("raw/candidates2.json"))
by_cluster = {str(v["cluster_id"]): v for v in cands.values()}

rows = []
for fn in sorted(os.listdir("raw/txt")):
    cid = fn[:-4]
    t = open("raw/txt/" + fn, encoding="utf-8", errors="replace").read()
    hits = len(TRIG.findall(t))
    # count quoted/italicized case-name patterns "X v. Y, NNN Rptr NNN"
    cites = len(re.findall(r"[A-Z][A-Za-z.'\-]+(?: [A-Za-z.'\-]+){0,4} v\.? [A-Z][A-Za-z.'\-]+", t))
    m = by_cluster.get(cid, {})
    rows.append((hits, cites, len(t), cid, (m.get("dateFiled") or "?"), (m.get("court") or "?")[:34], (m.get("caseName") or "?")[:52]))

rows.sort(reverse=True)
print(f"{'trig':>4} {'cites':>5} {'len':>7}  {'cluster':>9}  date        court                              case")
for r in rows: print(f"{r[0]:4d} {r[1]:5d} {r[2]:7d}  {r[3]:>9}  {r[4]}  {r[5]:<34} {r[6]}")
print("TOTAL", len(rows))
