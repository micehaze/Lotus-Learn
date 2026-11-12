"""Tests for the local dictionary service. The fixture lines below follow the real Kaikki and Wikidata dump formats;
they are TEST DATA ONLY (the shipped lexicon is built from the real datasets by setup_local_dictionary.py)."""
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from lotus_dict.langs import in_script, script_of  # noqa: E402
from lotus_dict.lexicon import Lexicon  # noqa: E402
from lotus_dict.llm import Ollama  # noqa: E402
from lotus_dict.server import Service, serve  # noqa: E402
from lotus_dict.translator import IndicTrans2  # noqa: E402

KAIKKI = [
    {"word": "பாட்டி", "lang_code": "ta", "pos": "noun", "senses": [{"glosses": ["grandmother"]}, {"glosses": ["an elderly woman"]}]},
    {"word": "கிராமம்", "lang": "Tamil", "lang_code": "ta", "pos": "noun", "forms": [{"form": "kirāmam", "tags": ["romanization"]}],
     "senses": [{"glosses": ["village"], "examples": [{"text": "இது ஒரு அழகான கிராமம்.", "english": "This is a beautiful village.", "type": "example"}], "synonyms": [{"word": "ஊர்"}]}]},
    {"word": "அன்பு", "lang": "Tamil", "lang_code": "ta", "pos": "noun", "senses": [{"glosses": ["love, affection"]}], "antonyms": [{"word": "வெறுப்பு"}]},
    {"word": "கண்டெத்துக", "lang": "Malayalam", "lang_code": "ml", "pos": "verb", "senses": []},
    {"word": "കണ്ടെത്തുക", "lang": "Malayalam", "lang_code": "ml", "pos": "verb", "senses": [{"glosses": ["to discover, to find"]}]},
    {"word": "love", "lang": "English", "lang_code": "en", "pos": "noun", "translations": [
        {"lang": "Tamil", "code": "ta", "word": "அன்பு", "sense": "affection"}, {"lang": "Tamil", "code": "ta", "word": "காதல்", "sense": "romantic love"},
        {"lang": "Malayalam", "code": "ml", "word": "സ്നേഹം"}, {"lang": "Kannada", "code": "kn", "word": "ಪ್ರೀತಿ"},
        {"lang": "Telugu", "code": "te", "word": "ప్రేమ"}, {"lang": "Hindi", "code": "hi", "word": "प्यार"}]},
    {"word": "discover", "lang": "English", "lang_code": "en", "pos": "verb", "translations": [{"lang": "Malayalam", "code": "ml", "word": "കണ്ടെത്തുക"}]},
    {"word": "go", "lang": "English", "lang_code": "en", "pos": "verb", "translations": [{"lang": "Kannada", "code": "kn", "word": "ಹೋಗು"}]},
    {"word": "beautiful", "lang": "English", "lang_code": "en", "pos": "adj", "translations": [{"lang": "Telugu", "code": "te", "word": "అందమైన"}]},
]
LEXEMES = [
    {"id": "L1", "language": "Q5885", "lexicalCategory": "Q1084", "lemmas": {"ta": {"value": "வீடு"}},
     "forms": [{"representations": {"ta": {"value": "வீட்டில்"}}, "grammaticalFeatures": ["Q202142"]}],
     "senses": [{"id": "L1-S1", "glosses": {"en": {"value": "house"}}, "claims": {"P5137": [{"mainsnak": {"datavalue": {"value": {"id": "Q3947"}}}}]}}]},
    {"id": "L2", "language": "Q36236", "lexicalCategory": "Q1084", "lemmas": {"ml": {"value": "വീട്"}},
     "senses": [{"id": "L2-S1", "glosses": {"en": {"value": "house"}}, "claims": {"P5137": [{"mainsnak": {"datavalue": {"value": {"id": "Q3947"}}}}]}}]},
    {"id": "L3", "language": "Q1860", "lexicalCategory": "Q1084", "lemmas": {"en": {"value": "house"}},
     "senses": [{"id": "L3-S1", "glosses": {"en": {"value": "building for living in"}}, "claims": {"P5972": [{"mainsnak": {"datavalue": {"value": {"id": "L1-S1"}}}}]}}]},
]


class PivotStub(IndicTrans2):
    """Test-only: records the directions requested so the pivot logic can be checked without model weights."""
    def __init__(self, indic_indic):
        super().__init__(use_indic_indic=indic_indic)
        self.calls = []

    def libraries(self):
        return []

    def _run(self, direction, texts, src, tgt, n_best=1, max_length=256):
        self.calls.append((direction, src, tgt))
        return [[f"<{tgt}>{t}"] for t in texts]


class LexiconTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        lex = Lexicon(os.path.join(cls.tmp, "lexicon.db"))
        lex.import_kaikki_lines([json.dumps(x, ensure_ascii=False) for x in KAIKKI])
        lex.import_lexemes(["[", *[json.dumps(x, ensure_ascii=False) + "," for x in LEXEMES], "]"])
        cls.svc = Service(cls.tmp, translator=IndicTrans2(local_only=True), llm=Ollama(url="http://127.0.0.1:9", model="gemma3:4b", timeout=2))

    def test_english_to_native_uses_translation_tables(self):
        r = self.svc.lookup({"text": "love", "lang": "ta", "direction": "from_en"})
        natives = [c["native"] for c in r["candidates"]]
        self.assertIn("அன்பு", natives); self.assertIn("காதல்", natives)
        self.assertEqual(next(c for c in r["candidates"] if c["native"] == "காதல்")["sense"], "romantic love", "senses are kept apart")
        for word, lang, expect in [("discover", "ml", "കണ്ടെത്തുക"), ("go", "kn", "ಹೋಗು"), ("beautiful", "te", "అందమైన")]:
            self.assertIn(expect, [c["native"] for c in self.svc.lookup({"text": word, "lang": lang, "direction": "from_en"})["candidates"]])

    def test_reverse_gloss_index_and_inflected_form(self):
        r = self.svc.lookup({"text": "village", "lang": "ta", "direction": "from_en"})
        self.assertEqual(r["candidates"][0]["native"], "கிராமம்")
        inf = self.svc.lookup({"text": "கிராமத்தில்", "lang": "ta", "direction": "to_en", "candidates": ["கிராமம்"]})
        self.assertEqual(inf["via"], "morphological analysis")
        self.assertEqual(inf["entries"][0]["senses"][0]["gloss"], "village")
        self.assertEqual(inf["entries"][0]["senses"][0]["examples"][0]["english"], "This is a beautiful village.")
        self.assertIn("ஊர்", [x["word"] for x in inf["entries"][0]["senses"][0]["relations"]["synonym"]])
        wd = self.svc.lookup({"text": "வீட்டில்", "lang": "ta", "direction": "to_en"})
        self.assertEqual(wd["via"], "inflected form", "Wikidata forms map to their lemma")

    def test_cross_language_equivalents_keep_the_sense(self):
        eq = self.svc.equivalents({"word": "வீடு", "lang": "ta", "targets": ["ml"]})
        self.assertEqual(eq["equivalents"]["ml"][0]["native"], "വീട്")
        self.assertIn("Q3947", eq["equivalents"]["ml"][0]["basis"])
        eq2 = self.svc.equivalents({"word": "அன்பு", "lang": "ta", "targets": ["kn", "te", "hi"]})
        self.assertEqual(eq2["equivalents"]["kn"][0]["native"], "ಪ್ರೀತಿ")
        self.assertEqual(eq2["equivalents"]["hi"][0]["native"], "प्यार")

    def test_missing_models_and_ollama_degrade_gracefully(self):
        r = self.svc.lookup({"text": "zebra", "lang": "te", "direction": "from_en"})
        self.assertEqual(r["candidates"], [])
        self.assertTrue(r["machine_translation"].get("error"), "translator error is reported, nothing invented")
        e = self.svc.enrich({"word": "அன்பு", "lang": "ta", "gloss": "love"})
        self.assertIsNone(e["llm"]); self.assertIn("not reachable", e["llm_error"])
        self.assertFalse(self.svc.health()["paid_apis"])

    def test_pivot_through_english_when_no_indic_indic_model(self):
        t = PivotStub(indic_indic=False)
        out, path = t.translate(["ಮನೆ"], "kn", "te")
        self.assertEqual(path, ["kn", "en", "te"]); self.assertEqual(t.calls, [("indic-en", "kn", "en"), ("en-indic", "en", "te")])
        t2 = PivotStub(indic_indic=True); _, p2 = t2.translate(["ಮನೆ"], "kn", "te")
        self.assertEqual(p2, ["kn", "te"])

    def test_script_validation(self):
        self.assertTrue(in_script("அன்பு", "ta")); self.assertFalse(in_script("love", "ta")); self.assertFalse(in_script("ಮನೆ", "te"))
        self.assertEqual(script_of("ఇల్లు"), "te"); self.assertEqual(script_of("house"), "en")

    def test_http_server(self):
        httpd, _ = serve("127.0.0.1", 0, service=self.svc)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        port = httpd.server_address[1]
        h = json.loads(urllib.request.urlopen(f"http://127.0.0.1:{port}/health").read())
        self.assertGreaterEqual(h["lexicon"]["entries"]["ta"], 2)
        req = urllib.request.Request(f"http://127.0.0.1:{port}/lookup", data=json.dumps({"text": "love", "lang": "te", "direction": "from_en"}).encode(), headers={"content-type": "application/json"})
        self.assertEqual(json.loads(urllib.request.urlopen(req).read())["candidates"][0]["native"], "ప్రేమ")
        httpd.shutdown()


if __name__ == "__main__":
    unittest.main(verbosity=2)
