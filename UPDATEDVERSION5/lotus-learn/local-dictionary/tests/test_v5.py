"""Regression coverage for definition search, generation filtering and web attribution."""
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lotus_dict.lexicon import Lexicon
from lotus_dict.llm import Ollama
from lotus_dict.web_examples import find_examples


class V5Tests(unittest.TestCase):
    def test_definition_search_respects_word_boundaries(self):
        with tempfile.TemporaryDirectory() as tmp:
            lex = Lexicon(Path(tmp) / "lex.db")
            data = [
                {"word": "கைவினை", "lang_code": "ta", "pos": "noun", "senses": [{"glosses": ["a traditional craft made by hand"]}]},
                {"word": "விமானம்", "lang_code": "ta", "pos": "noun", "senses": [{"glosses": ["an aircraft used for travel"]}]},
            ]
            lex.import_kaikki_lines(map(json.dumps, data))
            lex.rebuild_search()
            hits = lex.lookup_english("craft", "ta")
            self.assertEqual([x["native"] for x in hits], ["கைவினை"])
            self.assertIn("definition context", hits[0]["basis"])
            lex.db.close()

    def test_generated_examples_must_use_the_target(self):
        llm = Ollama(model="test-only")
        llm.json = lambda *_: {"synonyms": [{"native": "அழகு"}, {"native": "beauty"}, {"native": "எழில்"}],
            "examples": [{"native": "இது [[மரம்]] ஆகும்.", "english": "This is a tree."},
                         {"native": "இயற்கையின் [[அழகு]] எனக்குப் பிடிக்கும்.", "english": "I like nature's beauty."}],
            "collocations": {"common": [{"native": "மன அழகு", "english": "inner beauty"}, {"native": "நல்ல மரம்", "english": "good tree"}]}}
        result = llm.enrich("அழகு", "ta", "beauty")
        self.assertEqual(len(result["examples"]), 1)
        self.assertEqual([x["native"] for x in result["synonyms"]], ["எழில்"])
        self.assertEqual(len(result["collocations"]["common"]), 1)

    def test_web_examples_keep_source_and_short_excerpt(self):
        payload = {"query": {"pages": [{"fullurl": "https://ta.wikipedia.org/wiki/Test", "extract": "இயற்கையின் அழகு மனதிற்கு மகிழ்ச்சி தருகிறது."},
                                      {"fullurl": "https://untrusted.invalid/wiki/Test", "extract": "இது அழகு பற்றிய வாக்கியம்."}]}}
        def opener(req, timeout):
            self.assertTrue(req.full_url.startswith("https://ta.wikipedia.org/w/api.php?"))
            return io.BytesIO(json.dumps(payload).encode())
        result = find_examples("அழகு", "ta", opener)
        self.assertEqual(len(result), 1)
        self.assertIn("CC BY-SA", result[0]["note"])
        self.assertIn("https://ta.wikipedia.org/", result[0]["url"])
        self.assertEqual(find_examples("word", "invalid", opener), [])
