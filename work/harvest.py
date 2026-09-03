#!/usr/bin/env python3
import json, time, urllib.parse, urllib.request, os, sys

UA = "ExhibitB-benchmark-research/0.1 (+contact: 20012001amiramir@gmail.com)"
BASE = "https://www.courtlistener.com/api/rest/v4/"

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:
            print("  retry", attempt, e, file=sys.stderr)
            time.sleep(5 * (attempt + 1))
    return None

QUERIES = [
    '"hallucinated" "citations"',
    '"nonexistent case" citation brief',
    '"non-existent cases" citation',
    '"fabricated citations"',
    '"fictitious cases" cited',
    '"do not exist" "citations" "artificial intelligence"',
    '"ChatGPT" "does not exist" case cited',
    '"artificial intelligence" "fake citations"',
    '"bogus citations"',
    '"phantom citations"',
    '"citations to nonexistent"',
    '"quotations that do not appear"',
    '"misrepresents the holding" "artificial intelligence"',
    '"generative artificial intelligence" sanctions citations',
    '"Rule 11" "artificial intelligence" fabricated',
]

seen = {}
for q in QUERIES:
    url = BASE + "search/?" + urllib.parse.urlencode({"q": q, "type": "o", "order_by": "dateFiled desc"})
    page = 0
    while url and page < 6:
        d = get(url)
        if not d: break
        for r in d.get("results", []):
            cid = r["cluster_id"]
            if cid not in seen:
                seen[cid] = {
                    "cluster_id": cid, "case_name": r.get("caseName"),
                    "date_filed": r.get("dateFiled"), "court": r.get("court"),
                    "court_id": r.get("court_id"), "docket": r.get("docketNumber"),
                    "url": "https://www.courtlistener.com" + (r.get("absolute_url") or ""),
                    "queries": [],
                }
            seen[cid]["queries"].append(q)
        url = d.get("next"); page += 1
        time.sleep(1.2)
    print(f"{q!r}: total seen {len(seen)}", file=sys.stderr)

json.dump(seen, open("raw/candidates.json", "w"), indent=1)
print("CANDIDATES", len(seen))
