"""AI4Bharat IndicTrans2 (MIT licence) running locally through Hugging Face transformers.

en→indic and indic→en use the dedicated models. indic→indic uses the indic-indic model when the hardware plan
includes it, otherwise it pivots through English (src → en → tgt). Models load lazily and are cached in memory.
"""
import threading

from .langs import LANGS

MODELS = {
    "dist": {"en-indic": "ai4bharat/indictrans2-en-indic-dist-200M", "indic-en": "ai4bharat/indictrans2-indic-en-dist-200M", "indic-indic": "ai4bharat/indictrans2-indic-indic-dist-320M"},
    "full": {"en-indic": "ai4bharat/indictrans2-en-indic-1B", "indic-en": "ai4bharat/indictrans2-indic-en-1B", "indic-indic": "ai4bharat/indictrans2-indic-indic-1B"},
}


class TranslatorUnavailable(RuntimeError):
    pass


class IndicTrans2:
    def __init__(self, tier="dist", device="auto", use_indic_indic=True, local_only=True, cache_dir=None):
        self.tier, self.device_pref, self.use_indic_indic, self.local_only, self.cache_dir = tier, device, use_indic_indic, local_only, cache_dir
        self._models, self._lock, self._error, self.device = {}, threading.Lock(), None, None

    # ---------------------------------------------------------------- availability
    def libraries(self):
        missing = []
        for mod in ("torch", "transformers", "sentencepiece"):
            try:
                __import__(mod)
            except ImportError:
                missing.append(mod)
        try:
            self._processor_class()
        except ImportError:
            missing.append("IndicTransToolkit")
        return missing

    @staticmethod
    def _processor_class():
        try:
            from IndicTransToolkit.processor import IndicProcessor  # IndicTransToolkit >= 1.0
        except ImportError:
            from IndicTransToolkit import IndicProcessor  # older releases
        return IndicProcessor

    def status(self):
        missing = self.libraries()
        return {"engine": "IndicTrans2", "tier": self.tier, "models": MODELS[self.tier], "indic_indic": self.use_indic_indic,
                "libraries_missing": missing, "loaded": sorted(self._models), "device": self.device, "error": self._error,
                "available": not missing and self._error is None}

    def _pick_device(self):
        import torch
        if self.device_pref not in ("auto", None):
            return self.device_pref
        if torch.cuda.is_available():
            return "cuda"
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps"
        return "cpu"

    def _load(self, direction):
        if direction in self._models:
            return self._models[direction]
        missing = self.libraries()
        if missing:
            raise TranslatorUnavailable("Missing Python packages: " + ", ".join(missing) + " (run setup_local_dictionary.py)")
        import torch
        from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
        name = MODELS[self.tier][direction]
        self.device = self.device or self._pick_device()
        try:
            tok = AutoTokenizer.from_pretrained(name, trust_remote_code=True, local_files_only=self.local_only, cache_dir=self.cache_dir)
            dtype = torch.float16 if self.device == "cuda" else torch.float32
            model = AutoModelForSeq2SeqLM.from_pretrained(name, trust_remote_code=True, local_files_only=self.local_only, cache_dir=self.cache_dir, torch_dtype=dtype).to(self.device)
            model.eval()
        except Exception as e:  # noqa: BLE001 — surface a readable reason (e.g. model not downloaded)
            self._error = f"Could not load {name}: {e}"
            raise TranslatorUnavailable(self._error) from e
        self._models[direction] = (tok, model, self._processor_class()(inference=True))
        self._error = None
        return self._models[direction]

    # ---------------------------------------------------------------- translation
    def _run(self, direction, texts, src, tgt, n_best=1, max_length=256):
        tok, model, ip = self._load(direction)  # raises TranslatorUnavailable when libraries/models are missing
        import torch
        s, t = LANGS[src][0], LANGS[tgt][0]
        with self._lock:
            batch = ip.preprocess_batch(texts, src_lang=s, tgt_lang=t)
            inputs = tok(batch, truncation=True, padding="longest", return_tensors="pt", return_attention_mask=True).to(self.device)
            beams = max(5, n_best)
            with torch.no_grad():
                out = model.generate(**inputs, use_cache=True, min_length=0, max_length=max_length, num_beams=beams, num_return_sequences=n_best)
            decoded = tok.batch_decode(out, skip_special_tokens=True, clean_up_tokenization_spaces=True)
            decoded = ip.postprocess_batch(decoded, lang=t)
        groups = [decoded[i * n_best:(i + 1) * n_best] for i in range(len(texts))]
        return [list(dict.fromkeys(x.strip() for x in g if x.strip())) for g in groups]

    def translate(self, texts, src, tgt, n_best=1):
        """Returns ({'translations': [[candidates...] per input]}, path). Pivots through English when needed."""
        single = isinstance(texts, str)
        texts = [texts] if single else list(texts)
        if src == tgt:
            return [[t] for t in texts], [src]
        if src == "en":
            return self._run("en-indic", texts, src, tgt, n_best), ["en", tgt]
        if tgt == "en":
            return self._run("indic-en", texts, src, tgt, n_best), [src, "en"]
        if self.use_indic_indic:
            try:
                return self._run("indic-indic", texts, src, tgt, n_best), [src, tgt]
            except TranslatorUnavailable:
                pass
        mids = [c[0] if c else "" for c in self._run("indic-en", texts, src, "en", 1)]
        return self._run("en-indic", mids, "en", tgt, n_best), [src, "en", tgt]
