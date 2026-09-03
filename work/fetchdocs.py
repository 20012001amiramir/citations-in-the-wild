#!/usr/bin/env python3
import json, os, sys, time, subprocess, urllib.request, hashlib

UA = "ExhibitB-benchmark-research/0.1 (+contact: 20012001amiramir@gmail.com)"
os.makedirs("raw/pdf", exist_ok=True); os.makedirs("raw/txt", exist_ok=True)

def fetch(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            b = r.read()
        if len(b) < 500: return False
        open(dest, "wb").write(b); return True
    except Exception as e:
        print("   fail", e, file=sys.stderr); return False

cands = json.load(open("raw/candidates2.json"))
order = sorted(cands.values(), key=lambda v: v.get("dateFiled") or "", reverse=True)
ok = 0; skipped = 0
for v in order:
    cid = str(v["cluster_id"])
    tpath = f"raw/txt/{cid}.txt"
    if os.path.exists(tpath) and os.path.getsize(tpath) > 400: skipped += 1; continue
    urls = []
    for o in v.get("opinions") or []:
        if o.get("local_path"): urls.append("https://storage.courtlistener.com/" + o["local_path"])
        if o.get("download_url"): urls.append(o["download_url"])
    got = False
    for u in urls:
        p = f"raw/pdf/{cid}" + (".pdf" if ".pdf" in u.lower() else ".bin")
        if fetch(u, p):
            try:
                txt = subprocess.run(["pdftotext", "-layout", p, "-"], capture_output=True, timeout=120).stdout.decode("utf-8", "replace")
            except Exception: txt = ""
            if len(txt) < 400:
                try:
                    import fitz
                    txt = "\n".join(pg.get_text() for pg in fitz.open(p))
                except Exception: pass
            if len(txt) > 400:
                open(tpath, "w", encoding="utf-8").write(txt); got = True; ok += 1; break
        time.sleep(1)
    if not got: print("NOTEXT", cid, v.get("caseName"), file=sys.stderr)
    if (ok + skipped) % 25 == 0: print("progress ok=%d skip=%d" % (ok, skipped), file=sys.stderr)
    time.sleep(1.2)
print("FETCHED", ok, "SKIPPED", skipped)
