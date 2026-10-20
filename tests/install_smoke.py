"""Install pipeline smoke test: Install from Downloads (plain, FOMOD, already
exists), Nexus login page, and a live Thunderstore install for Valheim.

Run after tests/make_fake_home.sh (and after bridge_smoke.py, which sets up
Skyrim SE):  AMETHYST_SRC=../amethyst/src python3 tests/install_smoke.py
Set SKIP_NETWORK=1 to leave out the Thunderstore and Nexus parts.
"""
import json, os, subprocess, sys, time

here = os.path.dirname(os.path.abspath(__file__))
# Like inside Amethyst's Flatpak: XDG_* point into the sandbox, not the host dirs.
env = dict(os.environ, HOME="/tmp/bhome", PYTHONPATH=os.environ["AMETHYST_SRC"],
           FLATPAK_ID="io.github.Amethyst.ModManager",
           XDG_DATA_HOME="/tmp/bhome/.var/app/io.github.Amethyst.ModManager/data",
           XDG_CONFIG_HOME="/tmp/bhome/.var/app/io.github.Amethyst.ModManager/config")
p = subprocess.Popen([sys.executable, os.path.join(here, "..", "defaults", "amethyst_bridge.py")],
                     cwd=os.environ["AMETHYST_SRC"], env=env, stdin=subprocess.PIPE,
                     stdout=subprocess.PIPE, stderr=open("/tmp/install_stderr.log", "w"), text=True)
print("hello:", p.stdout.readline().strip())
n = 0
events = []

def call(m, **kw):
    global n; n += 1
    p.stdin.write(json.dumps({"id": n, "method": m, "params": kw}) + "\n"); p.stdin.flush()
    while True:
        r = json.loads(p.stdout.readline())
        if r.get("event"):
            events.append(r); continue
        assert r["id"] == n, r
        return r.get("result"), r.get("error")

def ok(m, **kw):
    r, e = call(m, **kw); assert not e, f"{m}: {e}"; return r

def wait_task(tid, timeout=600, final=False):
    """Poll until the task leaves 'working' (done/error/cancelled/choice);
    with final=True, until it has finished for good."""
    end = time.time() + timeout
    while time.time() < end:
        t = next(x for x in ok("tasks") if x["id"] == tid)
        if t["state"] not in (("working", "choice") if final else ("working",)):
            return t
        time.sleep(0.3)
    raise AssertionError(f"task {tid} stuck: {t}")

G, P = "Skyrim Special Edition", "default"
games = {g["name"]: g for g in ok("list_games")}
assert games[G]["configured"], "run bridge_smoke.py first"
print("skyrim sources:", games[G]["nexus_domain"], repr(games[G]["ts_community"]))

arch = ok("local_archives"); names = [a["name"] for a in arch]; print("archives:", names)
path = {a["name"]: a["path"] for a in arch}

# Plain archive: installs straight through.
t = wait_task(ok("install_archive", game=G, profile=P, path=path["Plain Mod-100-1-0.zip"])["id"])
print("plain:", t["state"], t["result"], t["error"]); assert t["state"] == "done", t
plain = t["result"]["installed"][0]
assert any(m["name"] == plain for m in ok("mods", game=G, profile=P))

# Same archive again: asks before replacing; answer "rename" keeps both.
t = wait_task(ok("install_archive", game=G, profile=P, path=path["Plain Mod-100-1-0.zip"])["id"])
assert t["state"] == "choice" and t["choice"]["kind"] == "exists", t
ok("task_answer", task_id=t["id"], value="rename"); t = wait_task(t["id"])
print("plain again (rename):", t["state"], t["result"]); assert t["result"]["installed"][0] != plain

# FOMOD: one step, Red recommended. Pick Blue instead.
t = wait_task(ok("install_archive", game=G, profile=P, path=path["Choice Mod-200-1-0.zip"])["id"])
assert t["state"] == "choice" and t["choice"]["kind"] == "fomod", t
v = ok("fomod_view", task_id=t["id"])
opts = v["steps"][0]["groups"][0]["options"]
print("fomod:", v["title"], [(o["name"], o["type"], o["selected"]) for o in opts])
assert [o["selected"] for o in opts] == [True, False]
v = ok("fomod_toggle", task_id=t["id"], step=v["steps"][0]["index"], group=0, name="Blue")
assert [o["selected"] for o in v["steps"][0]["groups"][0]["options"]] == [False, True]
ok("task_answer", task_id=t["id"], value="install"); t = wait_task(t["id"])
print("fomod install:", t["state"], t["result"], t["error"]); assert t["state"] == "done", t
staged = "/tmp/bhome/Games/Amethyst/Profiles/Skyrim Special Edition/mods/" + t["result"]["installed"][0]
files = sorted(os.path.relpath(os.path.join(r, f), staged) for r, _, fs in os.walk(staged) for f in fs)
print("fomod files:", files); assert "textures/blue.dds" in files and "textures/red.dds" not in files

# Cancel while a choice is open.
t = wait_task(ok("install_archive", game=G, profile=P, path=path["Choice Mod-200-1-0.zip"])["id"])
ok("task_cancel", task_id=t["id"]); t = wait_task(t["id"], final=True); print("cancelled:", t["state"]); assert t["state"] == "cancelled"
print("bad path:", call("install_archive", game=G, profile=P, path="/etc/passwd")[1])
print("task events seen:", sum(1 for e in events if e["event"] == "task"))

if not os.environ.get("SKIP_NETWORK"):
    print("nexus status:", ok("nexus_status"))
    # Amethyst's OAuth: the bridge returns the authorise page for Steam's browser
    # and listens on localhost:7890 for the redirect.
    url = ok("nexus_login_start")["url"]; print("login page:", url[:80])
    assert url.startswith("https://users.nexusmods.com/oauth/authorize?") and "localhost%3A7890" in url, url
    import socket; c = socket.create_connection(("127.0.0.1", 7890), timeout=5); c.close()
    ok("nexus_login_stop")
    print("nexus mods logged out:", call("nexus_mods", game=G)[1])

    V = "Valheim"
    r = ok("configure_game", game=V); print("configure valheim:", r["source"])
    page = ok("ts_mods", game=V, query="jotunn"); print("ts search:", [(m["namespace"], m["name"]) for m in page["mods"][:3]])
    jot = next(m for m in page["mods"] if m["name"] == "Jotunn")
    t = wait_task(ok("ts_install", game=V, profile=P, namespace=jot["namespace"], name=jot["name"])["id"])
    if t["state"] == "choice":
        assert t["choice"]["kind"] == "deps", t
        print("deps:", [d["label"] for d in t["choice"]["packages"]])
        ok("task_answer", task_id=t["id"], value=[d["id"] for d in t["choice"]["packages"]])
        t = wait_task(t["id"])
    print("ts install:", t["state"], t["result"], t["error"]); assert t["state"] == "done", t
    mods = [m["name"] for m in ok("mods", game=V, profile=P)]; print("valheim mods:", mods)
    meta = open(f"/tmp/bhome/Games/Amethyst/Profiles/Valheim/mods/{t['result']['installed'][-1]}/meta.ini").read()
    assert "[thunderstore]" in meta.lower() or "thunderstore" in meta.lower(), meta

p.stdin.close(); p.wait(); print("exit", p.returncode)
