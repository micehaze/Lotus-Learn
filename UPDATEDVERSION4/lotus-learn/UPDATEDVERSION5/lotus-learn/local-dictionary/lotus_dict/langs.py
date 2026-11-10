import re
import unicodedata

# code -> (IndicTrans2 FLORES code, English name, Wikidata language item, Unicode block)
LANGS = {
    "en": ("eng_Latn", "English", "Q1860", None),
    "ta": ("tam_Taml", "Tamil", "Q5885", (0x0B80, 0x0BFF)),
    "ml": ("mal_Mlym", "Malayalam", "Q36236", (0x0D00, 0x0D7F)),
    "kn": ("kan_Knda", "Kannada", "Q33673", (0x0C80, 0x0CFF)),
    "te": ("tel_Telu", "Telugu", "Q8097", (0x0C00, 0x0C7F)),
    "hi": ("hin_Deva", "Hindi", "Q1568", (0x0900, 0x097F)),
}
LEARNING = ["ta", "ml", "kn", "te"]
WIKIDATA_LANG = {v[2]: k for k, v in LANGS.items()}
NAME_TO_CODE = {v[1]: k for k, v in LANGS.items()}
# Wikidata lexical categories -> LotusLearn parts of speech
LEXICAL_CATEGORY = {"Q1084": "noun", "Q24905": "verb", "Q34698": "adjective", "Q380057": "adverb", "Q36224": "pronoun",
                    "Q147276": "noun", "Q36484": "conjunction", "Q83034": "interjection", "Q62155": "particle"}
POS = {"noun": "noun", "name": "noun", "verb": "verb", "adj": "adjective", "adv": "adverb", "pron": "pronoun",
       "postp": "postposition", "prep": "postposition", "conj": "conjunction", "intj": "interjection", "particle": "particle",
       "phrase": "idiom", "proverb": "idiom", "num": "noun", "det": "particle"}

_PUNCT = re.compile(r"[\u200c\u200d\u00a0\s]+")


def norm(text: str) -> str:
    """NFC, lower-case, strip zero-width joiners, surrounding punctuation and extra spaces."""
    s = unicodedata.normalize("NFC", str(text or "")).strip().lower()
    s = _PUNCT.sub(" ", s)
    return s.strip(" .,;:!?\"'“”‘’()[]{}-–—")


def script_of(text: str):
    counts = {}
    for ch in str(text or ""):
        cp = ord(ch)
        for code, v in LANGS.items():
            rng = v[3]
            if rng and rng[0] <= cp <= rng[1]:
                counts[code] = counts.get(code, 0) + 1
    if not counts:
        return "en" if re.search(r"[A-Za-z]", str(text or "")) else None
    return max(counts, key=counts.get)


def in_script(text: str, lang: str, min_ratio: float = 0.6) -> bool:
    """True if `text` is written (mostly) in the script of `lang` — used to reject invalid model output."""
    if lang == "en":
        return bool(re.search(r"[A-Za-z]", text or "")) and not any(ord(c) > 0x2000 and unicodedata.category(c).startswith("L") for c in text)
    rng = LANGS[lang][3]
    letters = [c for c in str(text or "") if unicodedata.category(c)[0] in "LM"]
    if not letters:
        return False
    own = sum(1 for c in letters if rng[0] <= ord(c) <= rng[1])
    return own / len(letters) >= min_ratio
