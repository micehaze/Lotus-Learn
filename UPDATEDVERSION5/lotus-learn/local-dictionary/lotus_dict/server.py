"""Local HTTP JSON service used by the LotusLearn Node backend (default http://127.0.0.1:8765).
Python standard-library server; heavy ML libraries are only imported when a translation is requested."""
import argparse
import json
import os
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .langs import LANGS, LEARNING, in_script, norm, script_of
from .lexicon import ATTRIBUTION, Lexicon
from .llm import LLMUnavailable, Ollama
from .translator import IndicTrans2, TranslatorUnavailable
from .web_examples import find_examples
from .collection import DictionaryCollection

HOME = Path(os.environ.get("LOTUS_DICT_HOME", Path(__file__).resolve().parent.parent / "data"))


class Service:
    def __init__(self, home=HOME, translator=None, llm=None):
        self.home = Path(home)
        self.home.mkdir(parents=True, exist_ok=True)
        cfg_path = self.home / "config.json"
        self.config = json.loads(cfg_path.read_text()) if cfg_path.exists() else {}
        t = self.config.get("translation", {})
        self.lexicon = DictionaryCollection(self.home)
        self.translator = translator or IndicTrans2(tier=t.get("tier", "dist"), device=t.get("device", "auto"), use_indic_indic=t.get("indic_indic", True),
                                                    local_only=True, cache_dir=str(self.home / "hf") if (self.home / "hf").exists() else None,
                                                    model_paths={d:str(self.home/'models'/d) for d in ('en-indic','indic-en') if (self.home/'models'/d/'config.json').exists()})
        self.llm = llm or Ollama(model=os.environ.get("OLLAMA_MODEL") or (self.config.get("llm") or {}).get("model") or "")
        self.generation_lock = threading.Lock()

    # ---------------------------------------------------------------- helpers
    def _translate(self, text, src, tgt, n=1, allow_ai=True):
        try:
            cands, path = self.translator.translate([text], src, tgt, n_best=n)
            good = [c for c in cands[0] if c and (tgt == "en" or in_script(c, tgt))]
            return {"candidates": good, "path": path, "engine": "IndicTrans2"}
        except TranslatorUnavailable as e:
            if allow_ai and self.llm.model:
                try:
                    with self.generation_lock:
                        items = self.llm.translate_word(text, src, tgt)
                    if items:
                        return {"candidates": [x["text"] for x in items], "path": [src, tgt],
                                "engine": "Ollama generated translation", "ai_unreviewed": True}
                except LLMUnavailable:
                    pass
            return {"candidates": [], "error": str(e), "engine": "IndicTrans2"}

    # ---------------------------------------------------------------- endpoints
    def health(self, _=None):
        return {"ok": True, "lexicon": self.lexicon.stats(), "translator": self.translator.status(), "llm": self.llm.status(),
                "attribution": ATTRIBUTION + [{"source": "AI4Bharat IndicTrans2", "license": "MIT", "url": "https://github.com/AI4Bharat/IndicTrans2"}],
                "paid_apis": False}

    def translate(self, body):
        text, src, tgt = str(body.get("text", "")).strip(), body.get("src") or script_of(body.get("text", "")), body.get("tgt", "en")
        if not text or src not in LANGS or tgt not in LANGS:
            return {"error": "text, src and tgt (en, ta, ml, kn, te, hi) are required"}, 400
        return self._translate(text, src, tgt, int(body.get("n", 1)), allow_ai=body.get("allow_ai", True))

    def lookup(self, body):
        """direction 'to_en': native word (any inflected form) → entries; 'from_en': English → native candidates."""
        text, lang, direction = str(body.get("text", "")).strip(), body.get("lang"), body.get("direction") or ("from_en" if script_of(body.get("text", "")) == "en" else "to_en")
        if not text or lang not in LEARNING:
            return {"error": "text and lang (ta, ml, kn, te) are required"}, 400
        out = {"query": text, "lang": lang, "direction": direction, "sources": []}
        if direction == "from_en":
            items = self.lexicon.lookup_english(text, lang)
            if items:
                out["sources"].append("lexicon")
            # Dictionary hits do not need slow generative inference on every keystroke/search.
            mt = self._translate(text, "en", lang, 4) if not body.get("lexicon_only") and not any(i["score"] >= 60 for i in items) else {"candidates": [], "engine": "lexicon"}
            out["machine_translation"] = mt
            for c in mt.get("candidates", []):
                if norm(c) not in {norm(i["native"]) for i in items}:
                    items.append({"native": c, "roman": "", "english": text, "sense": "", "pos": "", "basis": mt["engine"], "score": 55})
            if mt.get("candidates"):
                out["sources"].append("IndicTrans2")
            if body.get("disambiguate") and body.get("generate_senses") and len(items) > 1 and self.llm.status().get("available"):
                try:
                    senses = {x["native"]: x for x in self.llm.disambiguate(text, lang, [i["native"] for i in items])}
                    for i in items:
                        if i["native"] in senses and not i.get("sense"):
                            i["sense"] = senses[i["native"]].get("sense", ""); i["pos"] = i.get("pos") or senses[i["native"]].get("pos", "")
                    out["sources"].append(f"local LLM ({self.llm.model})")
                except LLMUnavailable:
                    pass
            out["candidates"] = sorted(items, key=lambda x: -x["score"])
        else:
            res = self.lexicon.lookup_native(text, lang, body.get("candidates") or [])
            out.update(entries=res["entries"], via=res["via"])
            if res["entries"]:
                out["sources"].append("lexicon")
            has_english=any(s.get('gloss') for e in res['entries'] for s in e['senses'])
            if (not has_english or body.get("always_translate")) and not body.get('lexicon_only'):
                mt = self._translate(text, lang, "en", 3)
                out["machine_translation"] = mt
                if mt.get("candidates"):
                    out["sources"].append("IndicTrans2")
            if body.get("context"):
                out["context_translation"] = self._translate(str(body["context"])[:400], lang, "en", 1)
        return out

    def suggest(self,body):
        text=str(body.get('text','')).strip()[:100];lang=body.get('lang')
        if lang not in LEARNING:return {'items':[]}
        return {'items':self.lexicon.suggest(text,lang)}

    def equivalents(self, body):
        word, lang, gloss = str(body.get("word", "")), body.get("lang"), str(body.get("gloss", ""))
        targets = [t for t in (body.get("targets") or [l for l in LEARNING + ["hi"] if l != lang]) if t in LANGS and t != lang]
        found = self.lexicon.equivalents(word, lang, targets, gloss)
        for t in targets:
            if found.get(t):
                continue
            # translate the English meaning of the selected sense (keeps the sense), else the word itself
            src_text, src = (gloss.split(";")[0].split("(")[0].strip(), "en") if gloss else (word, lang)
            mt = self._translate(src_text, src, t, 2)
            if mt.get("candidates"):
                found[t] = [{"native": c, "english": src_text if src == "en" else "", "basis": f"{mt['engine']} ({' → '.join(mt['path'])})"} for c in mt["candidates"][:2]]
        return {"word": word, "lang": lang, "equivalents": found}

    def enrich(self, body):
        word, lang = str(body.get("word", "")), body.get("lang")
        if lang not in LEARNING or not word:
            return {"error": "word and lang are required"}, 400
        lex = self.lexicon.lookup_native(word, lang)
        known = {"relations": {}, "examples": []}
        for e in lex["entries"]:
            for s in e["senses"]:
                for k, v in s["relations"].items():
                    known["relations"].setdefault(k, []).extend(x["word"] for x in v)
                known["examples"] += [x["text"] for x in s["examples"]]
            for k, v in e["relations"].items():
                known["relations"].setdefault(k, []).extend(x["word"] for x in v)
        result = {"word": word, "lang": lang, "lexicon": lex["entries"], "llm": None, "similar_words": self.lexicon.similar(word, lang)}
        result["web_examples"] = []
        if body.get("web") and os.environ.get("DICT_WEB_ENABLED", "true").lower() not in ("0", "false", "off") and len(known["examples"]) < 5:
            try:
                result["web_examples"] = find_examples(word, lang)
            except Exception as e:
                result["web_error"] = str(e)
        try:
            with self.generation_lock:
                result["llm"] = self.llm.enrich(word, lang, body.get("gloss", ""), body.get("pos", ""), known)
        except LLMUnavailable as e:
            result["llm_error"] = str(e)
        return result


def make_handler(service):
    routes = {("GET", "/health"): service.health, ("POST", "/translate"): service.translate, ("POST", "/lookup"): service.lookup,
              ("POST", "/equivalents"): service.equivalents, ("POST", "/enrich"): service.enrich, ("POST", "/suggest"): service.suggest}

    class Handler(BaseHTTPRequestHandler):
        server_version = "LotusDict/1.0"

        def _send(self, code, data):
            body = json.dumps(data, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("content-type", "application/json; charset=utf-8")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _handle(self, method):
            fn = routes.get((method, self.path.split("?")[0]))
            if not fn:
                return self._send(404, {"error": "not found"})
            try:
                length = int(self.headers.get("content-length") or 0)
                body = json.loads(self.rfile.read(length) or b"{}") if method == "POST" else {}
                # Runtime lexicon operations are read-only; inference has its own lock.
                res = fn(body)
                code = 200
                if isinstance(res, tuple):
                    res, code = res
                self._send(code, res)
            except Exception as e:  # noqa: BLE001
                traceback.print_exc()
                self._send(500, {"error": str(e)})

        def do_GET(self):
            self._handle("GET")

        def do_POST(self):
            self._handle("POST")

        def log_message(self, fmt, *args):
            if os.environ.get("LOTUS_DICT_LOG"):
                super().log_message(fmt, *args)

    return Handler


def serve(host="127.0.0.1", port=8765, home=HOME, service=None):
    svc = service or Service(home)
    httpd = ThreadingHTTPServer((host, port), make_handler(svc))
    return httpd, svc


def main():
    ap = argparse.ArgumentParser(description="LotusLearn local dictionary service")
    ap.add_argument("--host", default=os.environ.get("LOTUS_DICT_HOST", "127.0.0.1"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("LOTUS_DICT_PORT", 8765)))
    ap.add_argument("--home", default=str(HOME))
    ap.add_argument("--preload", action="store_true", help="load the translation models at start-up instead of on first use")
    a = ap.parse_args()
    httpd, svc = serve(a.host, a.port, a.home)
    if a.preload:
        threading.Thread(target=lambda: [svc._translate("hello", "en", l) for l in ("ta",)] and svc._translate("வணக்கம்", "ta", "en"), daemon=True).start()
    st = svc.health()
    print(f"LotusLearn local dictionary on http://{a.host}:{a.port}  lexicon={st['lexicon']['entries']}  "
          f"translator={'ready' if not st['translator']['libraries_missing'] else 'missing ' + ','.join(st['translator']['libraries_missing'])}  "
          f"llm={st['llm'].get('model') if st['llm'].get('available') else 'off'}")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
