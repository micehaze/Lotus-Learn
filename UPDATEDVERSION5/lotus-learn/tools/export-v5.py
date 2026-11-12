"""Create a separate Version 5 folder; refuse to overwrite any existing destination."""
import argparse
import shutil
import sqlite3
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    dest = args.destination.resolve()
    if dest.exists():
        raise SystemExit("Destination already exists; nothing was overwritten: " + str(dest))
    if dest == SOURCE or SOURCE in dest.parents:
        raise SystemExit("Destination must be outside the source project.")
    ignore = shutil.ignore_patterns('.git', '__pycache__', '*.pyc', '.venv', 'node_modules',
        'lotus.db', 'lotus.db-wal', 'lotus.db-shm', 'parallel_dictionary.json', 'OPEN-TAMIL-LICENSE.txt')
    shutil.copytree(SOURCE, dest, ignore=ignore)
    (dest / "data").mkdir(exist_ok=True)
    # The website may still be running. Backup includes committed WAL data consistently.
    with sqlite3.connect(f"file:{(SOURCE / 'data/lotus.db').as_posix()}?mode=ro", uri=True) as src:
        with sqlite3.connect(dest / 'data/lotus.db') as output:
            src.backup(output)
    print("Exported standalone application:", dest)


if __name__ == '__main__':
    main()
