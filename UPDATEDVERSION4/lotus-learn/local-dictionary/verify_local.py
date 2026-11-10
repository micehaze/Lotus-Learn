#!/usr/bin/env python3
"""Runs the required searches against the REAL local service (real IndicTrans2, real lexicon, real Ollama).
No mocks. Start the service first:  python -m lotus_dict.server
Exit code 0 only if every check produced a result in the right script."""
import json
import sys
import urllib.request

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765"
sys.path.insert(0, ".")
from lotus_dict.langs import in_script  # noqa: E402


def post(path, body):
    req = urllib.request.Request(URL + path, data=json.dumps(body).encode(), headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.loads(r.read())


health = json.loads(urllib.request.urlopen(URL + "/health", timeout=10).read())
print("translator:", health["translator"].get("engine"), health["translator"].get("tier"), "missing:", health["translator"]["libraries_missing"])
print("lexicon entries:", health["lexicon"]["entries"], "| llm:", health["llm"].get("model"), health["llm"].get("available"))
ok = True
for word, lang in [("love", "ta"), ("discover", "ml"), ("go", "kn"), ("beautiful", "te")]:
    r = post("/lookup", {"text": word, "lang": lang, "direction": "from_en"})
    cands = [c["native"] for c in r.get("candidates", [])]
    good = [c for c in cands if in_script(c, lang)]
    ok &= bool(good)
    print(f"EN '{word}' → {lang}: {cands[:8]}  sources={r['sources']}  mt_path={r.get('machine_translation', {}).get('path')}")
r = post("/lookup", {"text": "கிராமத்தில்", "lang": "ta", "direction": "to_en", "candidates": ["கிராமம்"], "always_translate": True})
glosses = [s["gloss"] for e in r.get("entries", []) for s in e["senses"]]
mt = r.get("machine_translation", {}).get("candidates", [])
ok &= bool(glosses or mt)
print(f"TA 'கிராமத்தில்' → en: via={r.get('via')} glosses={glosses[:3]} machine={mt}")
pairs = [("ta", "ml", "வீடு"), ("ml", "kn", "വീട്"), ("kn", "te", "ಮನೆ"), ("te", "ta", "ఇల్లు"), ("ta", "te", "தண்ணீர்"), ("ml", "ta", "വെള്ളം"),
         ("kn", "ml", "ನೀರು"), ("te", "kn", "నీళ్ళు"), ("ta", "kn", "மரம்"), ("ml", "te", "മരം"), ("kn", "ta", "ಮರ"), ("te", "ml", "చెట్టు")]
for src, tgt, w in pairs:
    t = post("/translate", {"text": w, "src": src, "tgt": tgt, "n": 2})
    good = [c for c in t.get("candidates", []) if in_script(c, tgt)]
    ok &= bool(good)
    print(f"{src}→{tgt} '{w}': {t.get('candidates')} path={t.get('path')} {t.get('error') or ''}")
print("\nRESULT:", "PASS" if ok else "FAIL (see lines above)")
sys.exit(0 if ok else 1)
