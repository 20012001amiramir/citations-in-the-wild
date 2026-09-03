#!/usr/bin/env python3
import json, time, urllib.request, urllib.parse, os, sys, re, html

UA = "ExhibitB-benchmark-research/0.1 (+contact: 20012001amiramir@gmail.com)"

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for a in range(6):
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:
            time.sleep(8 * (a + 1))
    return None

def strip(h):
    if not h: return ""
    h = re.sub(r"(?is)<(script|style).*?</\1>", " ", h)
    h = re.sub(r"(?i)</(p|div|br|h[1-6]|li|tr)>", "\n", h)
    h = re.sub(r"<[^>]+>", " ", h)
    h = html.unescape(h)
    h = re.sub(r"[ \t\xa0]+", " ", h)
    return re.sub(r"\n{3,}", "\n\n", h).strip()

cands = json.load(open("raw/candidates.json"))
ids = sorted(cands.keys(), key=lambda k: cands[k]["date_filed"] or "", reverse=True)
done = 0
for cid in ids:
    path = f"raw/texts/{cid}.txt"
    if os.path.exists(path) and os.path.getsize(path) > 200:
        continue
    d = get(f"https://www.courtlistener.com/api/rest/v4/opinions/?cluster={cid}")
    if not d:
        print("FAIL", cid, file=sys.stderr); time.sleep(3); continue
    parts = []
    for op in d.get("results", []):
        t = op.get("plain_text") or strip(op.get("html_with_citations") or op.get("html") or op.get("html_lawbox") or op.get("html_columbia") or "")
        if t: parts.append(t)
    txt = "\n\n===OPINION-BREAK===\n\n".join(parts)
    open(path, "w", encoding="utf-8").write(txt)
    done += 1
    if done % 20 == 0: print("fetched", done, file=sys.stderr)
    time.sleep(2.5)
print("DONE", done)
