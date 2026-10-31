"""Copy the shared generated JSON tables into the Python package."""

from pathlib import Path
import shutil


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    source = root.parent / "data"
    destination = root / "src" / "global_price_parser" / "data"
    destination.mkdir(parents=True, exist_ok=True)
    for path in sorted(source.glob("*.json")):
        shutil.copyfile(path, destination / path.name)
        print(f"Copied {path.name}")
    notice = root.parent / "NOTICE"
    for target in (root / "NOTICE", destination / "NOTICE"):
        shutil.copyfile(notice, target)
    print("Copied NOTICE into the distribution and package data")
    shutil.copyfile(root.parent / "LICENSE", root / "LICENSE")
    print("Copied LICENSE into the distribution")


if __name__ == "__main__":
    main()
