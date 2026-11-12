"""Exact lookups in locally indexed Wikipedia excerpts."""
import sqlite3
from urllib.parse import quote

from .langs import norm


class WikiUsage:
    def __init__(self, path):
        self.db = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, check_same_thread=False)
        self.counts = dict(self.db.execute("SELECT lang,COUNT(*) FROM words GROUP BY lang"))

    def lookup(self, word, lang):
        row = self.db.execute("""
            SELECT w.word, p.article, p.excerpt FROM words w
            JOIN passages p ON p.id=w.passage_id WHERE w.lang=? AND w.word=?
        """, (lang, norm(word))).fetchone()
        if row is None:
            return None
        headword, article, excerpt = row
        slug = quote(article.replace(" ", "_"), safe="")
        return {"word": headword, "article": article, "excerpt": excerpt, "lang": lang,
                "url": f"https://{lang}.wikipedia.org/wiki/{slug}", "license": "CC BY-SA 4.0"}
