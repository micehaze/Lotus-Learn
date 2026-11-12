"""Detect RAM, CPU, GPU/VRAM and free storage, and choose model sizes that this computer can run reliably."""
import json
import os
import platform
import shutil
import subprocess


def _ram_gb():
    try:
        import psutil
        return psutil.virtual_memory().total / 2**30
    except ImportError:
        pass
    if os.path.exists("/proc/meminfo"):
        with open("/proc/meminfo") as f:
            for line in f:
                if line.startswith("MemTotal"):
                    return int(line.split()[1]) / 2**20
    if platform.system() == "Darwin":
        out = subprocess.run(["sysctl", "-n", "hw.memsize"], capture_output=True, text=True).stdout.strip()
        return int(out) / 2**30 if out.isdigit() else 0
    if platform.system() == "Windows":
        import ctypes

        class MS(ctypes.Structure):
            _fields_ = [("l", ctypes.c_ulong), ("m", ctypes.c_ulong), ("t", ctypes.c_ulonglong), ("a", ctypes.c_ulonglong),
                        ("tp", ctypes.c_ulonglong), ("ap", ctypes.c_ulonglong), ("tv", ctypes.c_ulonglong), ("av", ctypes.c_ulonglong), ("e", ctypes.c_ulonglong)]
        ms = MS(); ms.l = ctypes.sizeof(MS)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(ms))
        return ms.t / 2**30
    return 0


def _gpus():
    gpus = []
    if shutil.which("nvidia-smi"):
        out = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"], capture_output=True, text=True).stdout
        for line in out.strip().splitlines():
            name, mem = [x.strip() for x in line.rsplit(",", 1)]
            gpus.append({"vendor": "nvidia", "name": name, "vram_gb": round(int(mem) / 1024, 1), "backend": "cuda"})
    if platform.system() == "Darwin" and platform.machine() == "arm64":
        gpus.append({"vendor": "apple", "name": "Apple Silicon (unified memory)", "vram_gb": None, "backend": "mps"})
    if shutil.which("rocm-smi") and not gpus:
        gpus.append({"vendor": "amd", "name": "AMD GPU (ROCm)", "vram_gb": None, "backend": "rocm",
                     "note": "Install a ROCm build of PyTorch to use it; CPU is used otherwise."})
    return gpus


def detect(path="."):
    usage = shutil.disk_usage(path)
    return {"os": f"{platform.system()} {platform.release()}", "arch": platform.machine(), "python": platform.python_version(),
            "cpu_cores": os.cpu_count() or 1, "ram_gb": round(_ram_gb(), 1), "gpus": _gpus(),
            "disk_free_gb": round(usage.free / 2**30, 1), "ollama_installed": bool(shutil.which("ollama"))}


def plan(hw):
    """Pick IndicTrans2 and Ollama model sizes. Conservative: prefer smaller models when unsure."""
    ram, disk = hw["ram_gb"], hw["disk_free_gb"]
    vram = max([g["vram_gb"] or 0 for g in hw["gpus"] if g["backend"] == "cuda"] + [0])
    apple = any(g["backend"] == "mps" for g in hw["gpus"])
    notes = []
    # ---- translation
    if vram >= 8 or (apple and ram >= 32):
        tier, indic_indic, device = "full", True, "cuda" if vram else "mps"
    elif ram >= 8:
        tier, indic_indic, device = "dist", True, "cuda" if vram else ("mps" if apple else "cpu")
    elif ram >= 5:
        tier, indic_indic, device = "dist", False, "cpu"
        notes.append("Less than 8 GB RAM: indic↔indic translation pivots through English to save memory.")
    else:
        tier, indic_indic, device = "dist", False, "cpu"
        notes.append("Under 5 GB RAM: translation will be slow and may fail under memory pressure; dictionary look-ups still work.")
    t_disk = (4.6 * (3 if indic_indic else 2)) if tier == "full" else (0.9 * 2 + (1.3 if indic_indic else 0))
    # ---- local LLM (Ollama). Gemma 3 handles Indic languages best among small open-weight models.
    if vram >= 12 or (apple and ram >= 32) or ram >= 32:
        llm, llm_disk = "gemma3:12b", 8.1
    elif vram >= 6 or ram >= 12:
        llm, llm_disk = "gemma3:4b", 3.3
    elif ram >= 8:
        llm, llm_disk = "gemma3:1b", 0.8
        notes.append("gemma3:1b is small; its Indic examples and nuances are weaker. Prefer more RAM for gemma3:4b.")
    else:
        llm, llm_disk = None, 0
        notes.append("Not enough RAM for a local LLM alongside translation: enrichment (examples, nuances) is disabled.")
    if not hw["ollama_installed"] and llm:
        notes.append("Ollama is not installed: install it from https://ollama.com/download, then re-run setup to pull the model.")
    # ---- datasets
    english = disk - t_disk - llm_disk > 12
    if not english:
        notes.append("Low disk space: English Wiktionary translation tables are skipped (English→Indic uses glosses + IndicTrans2).")
    need = t_disk + llm_disk + 1.5
    if disk < need:
        notes.append(f"Only {disk} GB free; about {need:.1f} GB is needed. Free space or choose --llm none.")
    return {"translation": {"tier": tier, "indic_indic": indic_indic, "device": device, "disk_gb": round(t_disk, 1)},
            "llm": {"model": llm, "disk_gb": llm_disk},
            "datasets": {"kaikki_languages": ["ta", "ml", "kn", "te"], "kaikki_english_translations": english, "wikidata_lexemes": True},
            "estimated_disk_gb": round(need, 1), "notes": notes}


if __name__ == "__main__":
    h = detect()
    print(json.dumps({"hardware": h, "plan": plan(h)}, indent=2))
