"""Free-account Nexus flow (Nexus.manual_install) with a stubbed Nexus API: the
task returns the file's download page, waits, and installs once the archive
lands in Downloads, with the Nexus ids in meta.ini.

Run after tests/make_fake_home.sh and tests/bridge_smoke.py:
    AMETHYST_SRC=../amethyst/src python3 tests/manual_download_check.py
"""
import os, sys, tempfile, threading, time, zipfile, shutil
os.environ["HOME"] = "/tmp/bhome"
sys.path[:0] = [os.environ["AMETHYST_SRC"],
                os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "defaults")]
os.chdir(os.environ["AMETHYST_SRC"])
sys.argv = ["amethyst", "list-games"]
import cli; cli._setup_path()
from Utils.games.discovery import discover_games
from Nexus.nexus_api import NexusModInfo, NexusModFile, NexusModFiles
from amethyst_tasks import Task, TaskManager
from amethyst_sources import Nexus

g = discover_games()["Skyrim Special Edition"]
pdir = g.get_profile_root() / "profiles" / "default"
dl = os.path.expanduser("~/Downloads"); arch = os.path.join(dl, "Late Mod-300-1-0.zip")
if os.path.exists(arch): os.remove(arch)
shutil.rmtree(g.get_mod_staging_path() / "Late Mod", ignore_errors=True)   # from an earlier run
info = NexusModInfo(mod_id=300, name="Late Mod", summary="", description="", version="1",
                    author="me", category_id=0, game_id=1704, domain_name="skyrimspecialedition")
buf = os.path.join(tempfile.mkdtemp(), "late.zip")
with zipfile.ZipFile(buf, "w") as z: z.writestr("textures/late.dds", b"DDS late")
f = NexusModFile(file_id=3000, name="Late Mod", version="1", category_name="MAIN",
                 file_name="Late Mod-300-1-0.zip", size_in_bytes=os.path.getsize(buf))
class Stub:
    def get_mod(self, d, m): return info
    def get_mod_files(self, d, m): return NexusModFiles(files=[f])
events = []
n = Nexus(lambda *a: None, print); n._api = Stub()
mgr = TaskManager(lambda e, d: events.append(d), print)
task = Task(mgr, "nexus", "Late Mod", g.name, "default")
url = {}
ready = threading.Event()
mgr.start(task, lambda t: n.manual_install(t, g, pdir, 300, 3000, threading.RLock(),
                                           lambda u: (url.update(u=u), ready.set())))
assert ready.wait(30), "no url"
print("url:", url["u"]); assert url["u"].endswith("/skyrimspecialedition/mods/300?tab=files&file_id=3000")
time.sleep(1.5); print("waiting step:", task.step, task.state); assert task.state == "working"
shutil.copy(buf, arch)   # the "browser download" lands
for _ in range(120):
    if task.state != "working": break
    time.sleep(0.5)
print("result:", task.state, task.result, task.error); assert task.state == "done", task.error
meta = open(g.get_mod_staging_path() / task.result["installed"][0] / "meta.ini").read()
print("meta modid:", [l for l in meta.splitlines() if l.lower().startswith(("modid", "fileid"))])
