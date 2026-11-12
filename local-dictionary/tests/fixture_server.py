"""Starts the REAL local dictionary service on a free port with a lexicon built from the test fixtures.
Used by the Node integration tests (no mocks: real HTTP, real SQLite index, real query code).
Translation models are not present in the build sandbox, so IndicTrans2 reports itself unavailable."""
import json
import os
import sys
import tempfile
import threading

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from lotus_dict.lexicon import Lexicon  # noqa: E402
from lotus_dict.llm import Ollama  # noqa: E402
from lotus_dict.server import Service, serve  # noqa: E402
from tests.test_service import KAIKKI, LEXEMES  # noqa: E402

home = tempfile.mkdtemp()
lex = Lexicon(os.path.join(home, "lexicon.db"))
lex.import_kaikki_lines([json.dumps(x, ensure_ascii=False) for x in KAIKKI])
lex.import_lexemes([json.dumps(x, ensure_ascii=False) for x in LEXEMES])
svc = Service(home, llm=Ollama(url="http://127.0.0.1:9", model="", timeout=1))
httpd, _ = serve("127.0.0.1", 0, service=svc)
print(json.dumps({"port": httpd.server_address[1]}), flush=True)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
sys.stdin.read()  # exits when the parent test process closes stdin
