#!/usr/bin/env python3
import json, time, urllib.parse, urllib.request, sys

UA = "ExhibitB-benchmark-research/0.1 (+contact: 20012001amiramir@gmail.com)"
BASE = "https://www.courtlistener.com/api/rest/v4/search/"

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for a in range(6):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:
            print("   retry", a, e, file=sys.stderr); time.sleep(10 * (a + 1))
    return None

QUERIES = [
 '"hallucinated" "citations"', '"nonexistent case" citation brief',
 '"non-existent cases" citation', '"fabricated citations"', '"fictitious cases" cited',
 '"do not exist" "citations" "artificial intelligence"', '"ChatGPT" "does not exist" case cited',
 '"artificial intelligence" "fake citations"', '"bogus citations"', '"phantom citations"',
 '"citations to nonexistent"', '"quotations that do not appear"',
 '"misrepresents the holding" "artificial intelligence"',
 '"generative artificial intelligence" sanctions citations',
 '"Rule 11" "artificial intelligence" fabricated',
 '"hallucinated cases"', '"could not locate" "cited" "artificial intelligence"',
 '"AI-generated" "citations" sanctions', '"fake case" "ChatGPT"',
 '"does not stand for the proposition" "artificial intelligence"',
 '"fabricated quotations"', '"invented" "citations" court "AI"',
 '"no such case exists"', '"Westlaw" "no results" fabricated citation AI',
]

import os
seen = json.load(open("raw/candidates2.json")) if os.path.exists("raw/candidates2.json") else {}
for q in QUERIES:
    url = BASE + "?" + urllib.parse.urlencode({"q": q, "type": "o", "order_by": "dateFiled desc", "highlight": "on"})
    page = 0
    while url and page < 5:
        d = get(url)
        if not d: break
        for r in d.get("results", []):
            cid = str(r["cluster_id"])
            if cid not in seen:
                seen[cid] = r; seen[cid]["_queries"] = []
            seen[cid]["_queries"].append(q)
        url = d.get("next"); page += 1
        time.sleep(3)
    json.dump(seen, open("raw/candidates2.json","w"), indent=1)
    print(f"{len(seen):4d}  {q}", file=sys.stderr)
    time.sleep(2)

json.dump(seen, open("raw/candidates2.json", "w"), indent=1)
withpdf = sum(1 for v in seen.values() if any(o.get("local_path") or o.get("download_url") for o in v.get("opinions") or []))
print("CANDIDATES", len(seen), "WITH_DOC", withpdf)
