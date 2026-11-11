"""Search independently licensed databases without combining their source datasets."""
from .lexicon import Lexicon
from .langs import norm
from .preferred import PREFERRED
from .datuk import Datuk
from .glossary import Glossary
import re


class DictionaryCollection:
    def __init__(self, home):
        self.lexicons = [Lexicon(home / "lexicon.db")]
        for name in ("alar.db", "olam.db"):
            if (home / name).exists():
                self.lexicons.append(Lexicon(home / name))
        self.datuk=Datuk(home/'datuk.db') if (home/'datuk.db').exists() else None
        self.glossary=Glossary(home/'glossaries.db') if (home/'glossaries.db').exists() else None

    def lookup_native(self, word, lang, candidates=()):
        results = [x.lookup_native(word, lang, candidates) for x in self.lexicons]
        if self.glossary:
            for form in [word,*candidates]:
                hits=self.glossary.lookup(form,lang,'en')
                if hits:
                    results.insert(0,{'via':'glossary headword' if form==word else 'morphological analysis','entries':[{'lang':lang,'word':form,'pos':x['pos'],'roman':'','source':'indic-glossaries','senses':[{'gloss':x['native'],'tags':[],'examples':[],'relations':{}}],'relations':{},'provenance':x['provenance']} for x in hits]});break
        if self.datuk: results.append(self.datuk.lookup_native(word,lang,candidates))
        return {"query": word, "lang": lang, "via": next((r["via"] for r in results if r["entries"]), None),
                "entries": [e for r in results for e in r["entries"]]}

    def lookup_english(self, word, lang, limit=12):
        items = (self.glossary.lookup(word,'en',lang) if self.glossary else []) + [i for x in self.lexicons for i in x.lookup_english(word, lang, limit)]
        for rank, preferred in enumerate(PREFERRED.get(norm(word), {}).get(lang, [])):
            for entry in self.lookup_native(preferred, lang)["entries"]:
                sense = next((s for s in entry["senses"] if re.search(r"\b" + re.escape(norm(word)) + r"\b", s["gloss"], re.I)), None)
                if sense:
                    items.append({"native": preferred, "roman": entry["roman"], "english": sense["gloss"], "sense": sense["gloss"],
                        "pos": entry["pos"], "basis": entry["source"] + " definition", "score": 110-rank})
                    break
        items.sort(key=lambda x: -x["score"])
        out, seen = [], set()
        for item in items:
            if item["native"] not in seen:
                seen.add(item["native"])
                # Include real lexical senses/relations on English lookups as well as native lookups.
                entries=self.lookup_native(item['native'],lang)['entries']
                # Put the selected English sense first; homographs must not replace it.
                selected=norm(item.get('sense') or item.get('english') or word)
                def rank(e):
                    return 0 if any(norm(s.get('gloss',''))==selected for s in e['senses']) else 1
                item['entries']=sorted(entries,key=rank)[:6]
                out.append(item)
        return out[:limit]

    def suggest(self,word,lang,limit=8):
        items=[x for lex in self.lexicons for x in lex.suggest(word,lang,limit)]
        seen=set();out=[]
        for x in items:
            if x['native'] not in seen:seen.add(x['native']);out.append(x)
        return out[:limit]

    def equivalents(self, word, lang, targets, gloss=""):
        out = {}
        for lex in self.lexicons:
            for target, items in lex.equivalents(word, lang, targets, gloss).items():
                out.setdefault(target, []).extend(items)
        # Pivot across databases as well as within each source.
        for target in targets:
            if not out.get(target) and gloss:
                out[target] = [{"native": x["native"], "english": gloss, "basis": "English sense pivot: " + x["basis"]}
                    for x in self.lookup_english(gloss.split(";")[0], target, 2) if x["score"] >= 60]
        return out

    def similar(self, word, lang):
        items = [x for lex in self.lexicons for x in lex.similar(word, lang)]
        seen, out = set(), []
        for x in sorted(items, key=lambda x: -x["similarity"]):
            if x["native"] not in seen:
                seen.add(x["native"])
                out.append(x)
        return out[:8]

    def stats(self):
        out = {"entries": {}, "english_translations": {}, "forms": 0, "sources": []}
        for lex in self.lexicons:
            st = lex.stats()
            for key in ("entries", "english_translations"):
                for lang, n in st[key].items():
                    out[key][lang] = out[key].get(lang, 0) + n
            out["forms"] += st["forms"]
            out["sources"].append(st["meta"])
        if self.datuk:
            out['datuk']=self.datuk.stats();out['native_definitions']=out['datuk']['definitions']
        if self.glossary:out['glossaries']=self.glossary.stats()
        return out
