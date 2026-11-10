"""Download reproducible supplementary dictionary sources and their licenses."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "local-dictionary"))
from setup_local_dictionary import download

DEST = Path(__file__).resolve().parents[1] / "local-dictionary/data/sources"
FILES = {
    "alar.yml": "https://raw.githubusercontent.com/alar-dict/data/master/alar.yml",
    "ALAR-LICENSE.txt": "https://raw.githubusercontent.com/alar-dict/data/master/LICENSE",
    "ALAR-README.md": "https://raw.githubusercontent.com/alar-dict/data/master/README.md",
    "enml.tar.gz": "https://olam.in/files/enml.tar.gz",
    "ODbL-1.0.txt": "https://opendatacommons.org/licenses/odbl/1-0.txt",
    "parallel_dictionary.json": "https://raw.githubusercontent.com/Ezhil-Language-Foundation/open-tamil/main/solthiruthi/data/parallel_dictionary.json",
    "OPEN-TAMIL-LICENSE.txt": "https://raw.githubusercontent.com/Ezhil-Language-Foundation/open-tamil/main/LICENSE",
}

if __name__ == "__main__":
    for name, url in FILES.items():
        dest = DEST / name
        if dest.exists():
            continue
        print("Downloading", name, flush=True)
        download(url, dest)
    print("Sources ready at", DEST)
