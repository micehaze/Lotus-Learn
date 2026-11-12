"""Small, attributed Wikipedia context excerpts. No scraping of private/social accounts."""
import json
import re
import urllib.parse
import urllib.request

from .langs import LEARNING, in_script


def find_examples(word, lang, opener=urllib.request.urlopen):
    if lang not in LEARNING or not word or len(word) > 100:
        return []
    params = urllib.parse.urlencode({"action": "query", "format": "json", "formatversion": 2,
        "generator": "search", "gsrsearch": '"' + word + '"', "gsrnamespace": 0, "gsrlimit": 2,
        "prop": "extracts|info", "inprop": "url", "explaintext": 1, "exintro": 1, "exlimit": 2, "exchars": 1000})
    req = urllib.request.Request(f"https://{lang}.wikipedia.org/w/api.php?{params}",
        headers={"User-Agent": "LotusLearn/5.0 (local educational dictionary; attributed context excerpts)"})
    with opener(req, timeout=8) as response:
        data = json.loads(response.read(100000))
    out = []
    for page in data.get("query", {}).get("pages", []):
        url = page.get("fullurl", "")
        if not url.startswith(f"https://{lang}.wikipedia.org/"):
            continue
        for sentence in re.split(r"(?<=[.!?।])\s+", page.get("extract", "")):
            sentence = sentence.strip()
            # One short sentence per source, with no more than 24 whitespace-delimited words.
            if word in sentence and 3 <= len(sentence.split()) <= 24 and len(sentence) <= 300 and in_script(sentence, lang):
                out.append({"native": sentence, "english": "", "url": url,
                    "note": "Wikipedia context excerpt (may use another sense); CC BY-SA; " + url})
                break
    return out[:2]
