"""Local LLM enrichment through Ollama (http://127.0.0.1:11434). No cloud calls."""
import json
import os
import urllib.error
import urllib.request

from .langs import LANGS, in_script


class LLMUnavailable(RuntimeError):
    pass


class Ollama:
    def __init__(self, url=None, model=None, timeout=180):
        self.url = (url or os.environ.get("OLLAMA_URL") or "http://127.0.0.1:11434").rstrip("/")
        self.model = model or os.environ.get("OLLAMA_MODEL") or ""
        self.timeout = timeout

    def _req(self, path, payload=None, timeout=None):
        data = json.dumps(payload).encode() if payload is not None else None
        req = urllib.request.Request(self.url + path, data=data, headers={"content-type": "application/json"}, method="POST" if data else "GET")
        try:
            with urllib.request.urlopen(req, timeout=timeout or self.timeout) as r:
                return json.loads(r.read().decode())
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            raise LLMUnavailable(f"Ollama not reachable at {self.url}: {e}") from e

    def status(self):
        if not self.model:
            return {"available": False, "reason": "No local model selected (OLLAMA_MODEL)", "url": self.url}
        try:
            tags = self._req("/api/tags", timeout=3)
        except LLMUnavailable as e:
            return {"available": False, "reason": str(e), "url": self.url, "model": self.model}
        names = [m.get("name") for m in tags.get("models", [])]
        ok = any(n == self.model or n.split(":")[0] == self.model.split(":")[0] and n.endswith(self.model.split(":")[-1]) for n in names)
        return {"available": ok, "model": self.model, "installed": names, "url": self.url, "reason": None if ok else f"Model {self.model} is not pulled (ollama pull {self.model})"}

    def json(self, system, prompt, temperature=0.2):
        if not self.model:
            raise LLMUnavailable("No local model selected")
        r = self._req("/api/generate", {"model": self.model, "system": system, "prompt": prompt, "format": "json", "stream": False,
                                        "options": {"temperature": temperature, "num_ctx": 4096}})
        text = r.get("response", "")
        try:
            return json.loads(text)
        except ValueError as e:
            raise LLMUnavailable("Local model returned invalid JSON") from e

    # ---------------------------------------------------------------- enrichment
    def enrich(self, word, lang, gloss, pos="", known=None):
        """Ask the local model for categorised lexical relations, collocations and examples. Output is validated:
        items not written in the right script are dropped, and duplicates of already-known (Wiktionary) items removed."""
        name = LANGS[lang][1]
        known = known or {}
        system = (f"You are a careful {name}–English lexicographer. Use only real, standard {name} words written in {name} script. "
                  "If you are not sure an item is correct, leave it out. Never pad lists.")
        prompt = f"""Word: {word} ({name}, {pos or 'part of speech unknown'}), meaning: "{gloss}".
Already known (do not repeat): {json.dumps(known, ensure_ascii=False)[:1200]}
Return JSON with these keys (each a list, up to 15 items, fewer if fewer are genuine):
"synonyms", "near_synonyms", "contextual_alternatives", "related": items {{"native": "", "english": "", "nuance": "", "difference": "how it differs from {word}", "context": ""}}
"antonyms", "contextual_opposites", "contrasts": items {{"native": "", "english": "", "nuance": "", "context": "where the opposition applies"}}
"collocations": {{"adj_noun": [], "noun_verb": [], "adv_verb": [], "common": []}} items {{"native": "", "english": "", "explanation": "", "structure": "real {name} construction"}}
"examples": 5-7 items {{"native": "natural {name} sentence with the word form wrapped in [[ ]]", "english": "", "register": "spoken|formal", "note": ""}}"""
        data = self.json(system, prompt)
        def clean(items, field="native"):
            out, seen = [], set()
            for it in items if isinstance(items, list) else []:
                v = str((it or {}).get(field, "")).strip() if isinstance(it, dict) else ""
                if v and v not in seen and in_script(v.replace("[[", "").replace("]]", ""), lang) and v != word:
                    seen.add(v)
                    out.append(it)
            return out[:15]
        result = {k: clean(data.get(k)) for k in ("synonyms", "near_synonyms", "contextual_alternatives", "related", "antonyms", "contextual_opposites", "contrasts")}
        cols = data.get("collocations") if isinstance(data.get("collocations"), dict) else {}
        result["collocations"] = {k: clean(cols.get(k)) for k in ("adj_noun", "noun_verb", "adv_verb", "common")}
        result["examples"] = [e for e in clean(data.get("examples")) if "[[" in e.get("native", "") or word in e.get("native", "")][:7]
        result["model"] = self.model
        return result

    def disambiguate(self, english, lang, candidates):
        """Group IndicTrans2/lexicon candidates for an English word into senses (no new words are invented)."""
        name = LANGS[lang][1]
        data = self.json(f"You are a {name}–English lexicographer.",
                         f"""English word: "{english}". Candidate {name} translations: {json.dumps(candidates, ensure_ascii=False)}.
For each candidate that is a correct translation, return {{"native": candidate, "sense": "which English sense it translates, in a few words", "pos": ""}}.
Return {{"items": [...]}}. Only use candidates from the list.""")
        allowed = set(candidates)
        return [x for x in data.get("items", []) if isinstance(x, dict) and x.get("native") in allowed]
