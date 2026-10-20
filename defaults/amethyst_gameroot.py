"""Find and check a game's root folder, whatever launcher installed it.

A launcher reports where it put a game, but that isn't always the folder
Amethyst needs (the one holding the game's exe and, for Bethesda games, the
Data folder with the base game's plugins). Stores nest games a level down,
and Epic's "Selective Downloads" titles (Fallout 3 GOTY, Fallout: New Vegas,
...) hold one full copy per language ("Fallout 3 GOTY English", "... French")
under a top-level Launcher.exe.

*markers* are paths relative to a game root that prove it is one: the game's
exe names (as Amethyst's handler lists them, sub-paths allowed) and, for
Bethesda games, "Data/<base plugin>". Matching is case-insensitive.
"""
from __future__ import annotations

from pathlib import Path

# Language spellings seen in Legendary install tags and folder names (same
# idea as Unifideck's utils/lang_normalize.py).
_LANGUAGES = (("en", "eng", "english"), ("fr", "fra", "french", "francais"),
              ("de", "deu", "ger", "german", "deutsch"), ("es", "esp", "spa", "spanish"),
              ("it", "ita", "italian", "italiano"), ("pl", "pol", "polish"),
              ("ru", "rus", "russian"), ("pt", "por", "portuguese", "brazilian"),
              ("ja", "jpn", "japanese"), ("zh", "chi", "chinese"), ("ko", "kor", "korean"))

_MAX_DIRS = 400      # subfolders listed per folder
_SEARCH_BUDGET = 300 # folders checked below a root in total; a game is never deeper
                     # than a couple of levels, so a bigger folder (Home, an SD card,
                     # a whole library) was simply the wrong pick


def language(text: str) -> "str | None":
    """ISO 639-1 code for a language word or tag ("French", "fr-FR", "deu")."""
    for word in text.lower().replace("_", "-").replace("-", " ").split():
        for group in _LANGUAGES:
            if word in group:
                return group[0]
    return None


def _listing(folder: Path, cache: dict) -> dict:
    """{lowercase name: entry} for *folder*, read once per check."""
    if folder not in cache:
        try:
            cache[folder] = {c.name.lower(): c for c in folder.iterdir()}
        except OSError:
            cache[folder] = {}
    return cache[folder]


def has_marker(folder: Path, markers: list[str]) -> bool:
    """True if any marker path exists under *folder* (case-insensitive). Each
    directory is listed once, however many markers share it."""
    cache: dict = {}
    for marker in markers:
        cur: "Path | None" = folder
        for part in [p for p in marker.replace("\\", "/").split("/") if p]:
            cur = _listing(cur, cache).get(part.lower())
            if cur is None:
                break
        if cur is not None:
            return True
    return False


def subdirs(folder: Path) -> list[Path]:
    try:
        dirs = sorted(d for d in folder.iterdir() if d.is_dir() and not d.name.startswith("."))
    except OSError:
        return []
    return dirs[:_MAX_DIRS]


def _pick(root: Path, hits: list[Path], languages: "list[str] | None") -> Path:
    """Several candidate roots (one per language): the language the store
    installed, else the one the launcher's settings name, else English."""
    by_lang = {language(d.name.split()[-1]): d for d in hits}
    for code in languages or []:
        if code in by_lang:
            return by_lang[code]
    try:
        settings = (root / "launcher_settings.cfg").read_text(errors="replace").lower()
    except OSError:
        settings = ""
    for d in hits:
        if d.name.lower() in settings or d.name.split()[-1].lower() in settings:
            return d
    return by_lang.get("en", hits[0])


def resolve(root: Path, markers: list[str], languages: "list[str] | None" = None,
            depth: int = 2) -> "tuple[Path, bool]":
    """(game root, found). The root itself if it has a marker, else the best
    folder up to *depth* levels below it that does; (root, False) if none."""
    if not markers:
        return root, True
    if has_marker(root, markers):
        return root, True
    level, budget = [root], _SEARCH_BUDGET
    for _ in range(depth):
        below: list[Path] = []
        for parent in level:
            below += subdirs(parent)
            if len(below) > budget:
                return root, False
        level, budget = below, budget - len(below)
        hits = [d for d in level if has_marker(d, markers)]
        if hits:
            return (hits[0] if len(hits) == 1 else _pick(root, hits, languages)), True
    return root, False
