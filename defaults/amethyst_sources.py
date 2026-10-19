"""Mod sources for the bridge: Nexus Mods and Thunderstore.

Nexus login is zero-mouse: the plugin shows a QR code for a page this module
serves on the local network, and the user pastes their personal API key there
from their phone. (Amethyst's GUI uses OAuth with a localhost redirect, which
would need a cursor in Steam's browser.) The key is stored with Amethyst's own
save_api_key, and Amethyst's NexusAPI accepts it.
"""
from __future__ import annotations

import html
import http.server
import secrets
import socket
import threading
import time
import urllib.parse
from pathlib import Path

from amethyst_tasks import Task, TaskError, install_archive_flow, strip_markup

PAGE_SIZE = 20


def nexus_domain(g) -> str:
    """Same lookup as Utils/mods/install.py _nexus_domain_for."""
    return getattr(g, "nexus_game_domain", None) or getattr(g, "game_id", "") or ""


def ts_community(g) -> str:
    try:
        return str(getattr(g, "thunderstore_community", "") or "")
    except Exception:
        return ""


# ---------------------------------------------------------------- Nexus


class Nexus:
    def __init__(self, emit, log):
        self.emit = emit
        self.log = log
        self._api = None
        self._user = None
        self._checked = 0.0
        self._server = None
        self._mod_cache: dict = {}   # (domain, mod_id) -> (time, info, files)

    # ----- credentials

    def api(self):
        """Saved OAuth login if the GUI made one (gui_qt/app.py
        _load_saved_nexus_api), else the API key saved by this plugin."""
        if self._api is not None:
            return self._api
        from Nexus.nexus_api import NexusAPI, load_api_key
        try:
            from Nexus.nexus_oauth import load_oauth_tokens
            tokens = load_oauth_tokens()
            if tokens is not None:
                self._api = NexusAPI.from_oauth(tokens)
                return self._api
        except Exception as e:
            self.log(f"nexus oauth: {e}")
        key = load_api_key()
        if key:
            self._api = NexusAPI(api_key=key)
        return self._api

    def require(self):
        api = self.api()
        if api is None:
            raise TaskError("Log in to Nexus Mods first.")
        return api

    def status(self, refresh=False) -> dict:
        api = self.api()
        if api is None:
            return {"logged_in": False}
        if refresh or self._user is None or time.time() - self._checked > 600:
            try:
                self._user = api.validate()
                self._checked = time.time()
            except Exception as e:
                self._api = self._user = None
                return {"logged_in": False, "error": f"Nexus rejected the saved login: {e}"}
        return self._info(self._user)

    @staticmethod
    def _info(user) -> dict:
        return {"logged_in": True, "name": user.name, "premium": bool(user.is_premium)}

    def use_key(self, key: str) -> dict:
        key = (key or "").strip()
        if len(key) < 20:
            raise TaskError("That doesn't look like a Nexus API key.")
        from Nexus.nexus_api import NexusAPI, save_api_key
        api = NexusAPI(api_key=key)
        try:
            user = api.validate(bypass_cache=True)
        except Exception as e:
            raise TaskError(f"Nexus didn't accept that key: {e}")
        save_api_key(key)
        self._api, self._user, self._checked = api, user, time.time()
        info = self._info(user)
        self.emit("nexus_login", info)
        return info

    def logout(self) -> dict:
        from Nexus.nexus_api import clear_api_key
        clear_api_key()
        try:
            from Nexus.nexus_oauth import clear_oauth_tokens
            clear_oauth_tokens()
        except Exception as e:
            self.log(f"clear oauth: {e}")
        self._api = self._user = None
        self.stop_login()
        return {"logged_in": False}

    # ----- phone login page

    @staticmethod
    def _lan_ip() -> str:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("192.0.2.1", 9))   # no packet is sent for UDP connect
            return s.getsockname()[0]
        except OSError:
            return ""
        finally:
            s.close()

    def start_login(self) -> dict:
        self.stop_login()
        ip = self._lan_ip()
        if not ip:
            raise TaskError("No network connection. Connect to Wi-Fi and try again.")
        token = secrets.token_urlsafe(12)
        nexus = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _page(self, body, status=200):
                doc = (
                    "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"
                    "<title>Amethyst Deploy</title><style>body{font:16px system-ui;margin:24px;"
                    "max-width:520px;background:#1b2838;color:#dfe3e6}a{color:#66c0f4}"
                    "textarea{width:100%;height:120px;font:14px monospace}"
                    "button{font-size:18px;padding:10px 20px;margin-top:12px}</style>" + body)
                data = doc.encode()
                self.send_response(status)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def _ok_path(self):
                return urllib.parse.urlparse(self.path).path == f"/{token}"

            def do_GET(self):
                if not self._ok_path():
                    return self._page("<p>Not found.</p>", 404)
                self._page(
                    "<h2>Log in to Nexus Mods</h2><ol>"
                    "<li>Open <a href='https://next.nexusmods.com/settings/api-keys' target=_blank>"
                    "your Nexus API keys</a> and log in.</li>"
                    "<li>Copy your <b>Personal API Key</b> (bottom of the page).</li>"
                    "<li>Paste it here and press Send.</li></ol>"
                    f"<form method=post action='/{token}'><textarea name=key "
                    "placeholder='Paste your API key'></textarea><br><button>Send to Steam Deck</button></form>")

            def do_POST(self):
                if not self._ok_path():
                    return self._page("<p>Not found.</p>", 404)
                n = min(int(self.headers.get("Content-Length") or 0), 8192)
                form = urllib.parse.parse_qs(self.rfile.read(n).decode(errors="replace"))
                try:
                    info = nexus.use_key((form.get("key") or [""])[0])
                except TaskError as e:
                    return self._page(f"<p>{html.escape(str(e))}</p><p><a href='/{token}'>Try again</a></p>")
                self._page(f"<h2>Done</h2><p>Logged in as {html.escape(info['name'])}. "
                           "You can close this page.</p>")
                threading.Thread(target=nexus.stop_login, daemon=True).start()

        server = http.server.ThreadingHTTPServer(("0.0.0.0", 0), Handler)
        self._server = server
        threading.Thread(target=server.serve_forever, daemon=True, name="nexus-login").start()
        # Don't leave the page open forever.
        timer = threading.Timer(15 * 60, lambda: self._server is server and self.stop_login())
        timer.daemon = True   # must not keep the bridge alive on exit
        timer.start()
        return {"url": f"http://{ip}:{server.server_address[1]}/{token}"}

    def stop_login(self):
        server, self._server = self._server, None
        if server is not None:
            server.shutdown()
            server.server_close()
        return {}

    # ----- browse

    @staticmethod
    def _card(m) -> dict:
        return {"id": m.mod_id, "name": m.name, "summary": strip_markup(m.summary, 300),
                "picture": m.picture_url or "", "author": m.author or m.uploaded_by,
                "version": m.version, "endorsements": m.endorsement_count,
                "downloads": m.downloads_total, "category": m.category_name,
                "updated": m.updated_at or ""}

    def mods(self, g, query="", sort="downloads", page=0) -> dict:
        """gui_qt/nexus_browser_view.py: top mods by sort key, or a name search."""
        api, domain = self.require(), nexus_domain(g)
        if not domain:
            raise TaskError(f"{g.name} isn't on Nexus Mods.")
        offset = max(0, int(page)) * PAGE_SIZE
        if query.strip():
            items = api.search_mods(domain, query.strip(), count=PAGE_SIZE,
                                    offset=offset, sort_key=sort)
        else:
            items = api.get_top_mods(domain, count=PAGE_SIZE, offset=offset, sort_key=sort)
        cards = [self._card(m) for m in items
                 if m.available and not m.contains_adult_content]
        return {"mods": cards, "more": len(items) >= PAGE_SIZE}

    _FILE_ORDER = {"MAIN": 0, "UPDATE": 1, "OPTIONAL": 2, "MISCELLANEOUS": 3}

    def _mod_data(self, api, domain: str, mod_id: int):
        """get_mod + get_mod_files, kept for 5 minutes: the details view loads
        them and an install from it needs them again (Nexus rate-limits)."""
        key = (domain, int(mod_id))
        hit = self._mod_cache.get(key)
        if hit and time.time() - hit[0] < 300:
            return hit[1], hit[2]
        info = api.get_mod(domain, int(mod_id))
        files = api.get_mod_files(domain, int(mod_id)).files
        self._mod_cache = {k: v for k, v in self._mod_cache.items() if time.time() - v[0] < 300}
        self._mod_cache[key] = (time.time(), info, files)
        return info, files

    def mod(self, g, mod_id: int) -> dict:
        api, domain = self.require(), nexus_domain(g)
        info, all_files = self._mod_data(api, domain, mod_id)
        files = [f for f in all_files if f.category_name in self._FILE_ORDER]
        files.sort(key=lambda f: (self._FILE_ORDER[f.category_name], -f.uploaded_timestamp))
        card = self._card(info)
        card["description"] = strip_markup(info.description)
        card["files"] = [{"id": f.file_id, "name": f.name, "version": f.version,
                          "category": f.category_name, "file_name": f.file_name,
                          "size": f.size_in_bytes or f.size_kb * 1024,
                          "description": strip_markup(f.description, 400),
                          "primary": f.is_primary} for f in files]
        st = self.status()
        card["premium"] = bool(st.get("premium"))
        return card

    def download_install(self, task: Task, g, profile_dir: Path, mod_id: int,
                         file_id: int, game_lock) -> dict:
        """Premium download (gui_qt/nexus_browser_view.py worker: download into the
        game's cache folder, build meta from the known ids) then install."""
        api = self.require()
        if not self.status().get("premium"):
            raise TaskError("Downloading straight from Nexus needs Nexus Premium. "
                            "Free accounts can install files saved to Downloads.")
        domain = nexus_domain(g)
        from Nexus.nexus_download import NexusDownloader
        from Nexus.nexus_meta import build_meta_from_download
        from Utils.config_paths import get_download_cache_dir_for_game
        task.set_step("Looking up the file")
        info, files = self._mod_data(api, domain, mod_id)
        file = next((f for f in files if f.file_id == int(file_id)), None)
        if file is None:
            raise TaskError("That file is no longer on Nexus.")
        task.title = info.name
        dest = get_download_cache_dir_for_game(g.name)
        task.set_step(f"Downloading {file.file_name}", [0, int(file.size_in_bytes or 0)])
        result = NexusDownloader(api, download_dir=dest).download_file(
            game_domain=domain, mod_id=int(mod_id), file_id=int(file_id), dest_dir=dest,
            known_file_name=file.file_name,
            expected_size_bytes=int(file.size_in_bytes or file.size_kb * 1024 or 0),
            progress_cb=lambda d, t: task.set_progress(d, t, f"Downloading {file.file_name}"),
            cancel=task.cancel)
        task.check()
        if not result.success or result.file_path is None:
            raise TaskError(f"Download failed: {result.error or 'unknown error'}")
        meta = build_meta_from_download(game_domain=domain, mod_id=int(mod_id),
                                        file_id=int(file_id), archive_name=result.file_name,
                                        mod_info=info, file_info=file)
        name = install_archive_flow(task, g, profile_dir, Path(result.file_path),
                                    game_lock=game_lock, meta=meta)
        return {"installed": [name]}


# ---------------------------------------------------------------- Thunderstore


class Thunderstore:
    def __init__(self, log):
        self.log = log

    def mods(self, g, query="", ordering="most-downloaded", page=0) -> dict:
        """gui_qt Thunderstore browser: one listing page for the game's community."""
        from Thunderstore.thunderstore_api import fetch_listing, PAGE_SIZE as TS_PAGE
        community = ts_community(g)
        if not community:
            raise TaskError(f"{g.name} isn't on Thunderstore.")
        items, count = fetch_listing(community, page=int(page), query=query.strip(),
                                     ordering=ordering)
        cards = [{"namespace": p.namespace, "name": p.name,
                  "label": p.name.replace("_", " "), "summary": p.description,
                  "picture": p.icon_url, "author": p.namespace,
                  "downloads": p.download_count, "rating": p.rating_count,
                  "size": p.size, "updated": p.last_updated}
                 for p in items if not p.is_nsfw and not p.is_deprecated]
        return {"mods": cards, "more": (int(page) + 1) * TS_PAGE < count}

    def download_install(self, task: Task, g, profile_dir: Path, namespace: str,
                         name: str, game_lock) -> dict:
        """Mirror of gui_qt/app.py _handle_ror2mm -> _on_ror2mm_resolved ->
        _start_ror2mm_downloads -> _on_ror2mm_download_done: resolve the pinned
        dependency graph, confirm extra packages, download, install in order
        (dependencies first), then stamp each folder's [thunderstore] meta."""
        from Thunderstore.thunderstore_api import fetch_latest_version
        from Thunderstore.ror2mm_handler import Ror2mmLink
        from Thunderstore.thunderstore_requirements import (
            filter_already_installed, resolve_dependencies)
        from Thunderstore.thunderstore_download import download_package
        from Thunderstore.thunderstore_meta import build_meta_from_link, read_meta, write_meta
        from Utils.config_paths import get_download_cache_dir_for_game
        from Utils.mods.copy import resolve_target_staging

        community = ts_community(g)
        task.set_step("Checking dependencies")
        version = fetch_latest_version(namespace, name)
        if not version:
            raise TaskError(f"Couldn't find {namespace}-{name} on Thunderstore.")
        link = Ror2mmLink(namespace=namespace, name=name, version=version)
        link.community = community
        res = resolve_dependencies(link, community=community)
        if res.failed:
            raise TaskError("Couldn't look up every dependency: " + ", ".join(res.failed[:3]))
        staging = Path(resolve_target_staging(g, Path(profile_dir)))
        wanted, _present = filter_already_installed(list(res.packages), staging)
        deps = [p for p in wanted if not p.is_root]
        if deps:
            # The GUI never installs dependencies silently: it lists them, opt-out.
            picked = task.ask({"kind": "deps", "mod": name.replace("_", " "),
                               "packages": [{"id": p.package_id, "label": p.name.replace("_", " "),
                                             "version": p.version, "author": p.namespace}
                                            for p in deps]})
            keep = set(picked or [])
            wanted = [p for p in wanted if p.is_root or p.package_id in keep]

        dest = get_download_cache_dir_for_game(g.name)
        downloads = []
        for i, pkg in enumerate(wanted, 1):
            sub = Ror2mmLink(namespace=pkg.namespace, name=pkg.name, version=pkg.version)
            sub.community = community
            label = f"Downloading {pkg.name} ({i}/{len(wanted)})"
            task.set_step(label, [0, int(pkg.file_size or 0)])
            r = download_package(sub, dest_dir=dest, expected_size=pkg.file_size,
                                 progress_cb=lambda d, t: task.set_progress(d, t, label),
                                 cancel=task.cancel)
            task.check()
            if not r.success or not r.file_path:
                raise TaskError(f"Download of {pkg.name} failed: {r.error}")
            info = {"full_version_name": pkg.full_name, "download_url": pkg.download_url,
                    "description": pkg.description, "website_url": pkg.website_url,
                    "icon_url": pkg.icon_url, "size": pkg.file_size,
                    "dependencies": pkg.dependencies}
            downloads.append((Path(r.file_path), sub, info, pkg.is_root))

        installed = []
        for path, sub, info, is_root in downloads:
            folder = install_archive_flow(task, g, profile_dir, path,
                                          game_lock=game_lock, interactive=is_root)
            installed.append(folder)
            # gui_qt/app.py _stamp_thunderstore_meta
            try:
                meta = build_meta_from_link(sub, info)
                meta_path = staging / folder / "meta.ini"
                existing = read_meta(meta_path)
                if not existing.package_id or existing.package_id == meta.package_id:
                    write_meta(meta_path, meta)
            except Exception as e:
                task.log(f"could not stamp meta.ini: {e}")
        return {"installed": installed}
