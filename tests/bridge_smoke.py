import json, subprocess, sys, os, struct
sys.path.insert(0, os.path.dirname(__file__)); import importlib.util
spec = importlib.util.spec_from_file_location("mk", os.path.join(os.path.dirname(__file__), "mkplugin.py"))
env = dict(os.environ, HOME="/tmp/bhome", PYTHONPATH=os.environ["AMETHYST_SRC"])
p = subprocess.Popen([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "defaults", "amethyst_bridge.py")],
                     cwd=os.environ["AMETHYST_SRC"], env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                     stderr=open("/tmp/bridge_stderr.log", "w"), text=True)
print("hello:", p.stdout.readline().strip())
n = 0
def call(m, **kw):
    global n; n += 1
    p.stdin.write(json.dumps({"id": n, "method": m, "params": kw}) + "\n"); p.stdin.flush()
    r = json.loads(p.stdout.readline()); assert r["id"] == n
    return r.get("result"), r.get("error")
def plugin(path, masters):
    def sub(t, d): return t.encode()+struct.pack("<H", len(d))+d
    body = sub("HEDR", struct.pack("<fiI", 1.71, 0, 0x800))
    for m in masters: body += sub("MAST", m.encode()+b"\0") + sub("DATA", b"\0"*8)
    open(path, "wb").write(b"TES4"+struct.pack("<IIIIHH", len(body), 0, 0, 0, 44, 0)+body)

G = "Skyrim Special Edition"
r, e = call("list_games"); sk = next(x for x in r if x["name"] == G); print("skyrim before:", sk["configured"], sk["has_plugins"], sk["loot"])
det, e = call("detect_installed"); print("detect:", det, e)
assert {"name": G, "launchers": ["steam"]} in det, det
assert any(d["name"] == "Fallout New Vegas" and "heroic" in d["launchers"] for d in det), det
r, e = call("configure_game", game="Fallout New Vegas"); print("configure FNV:", r, e)
assert not e and r["source"] == "heroic" and r["prefix"].endswith("Prefixes/1454587428/pfx"), (r, e)
assert not r["needs_first_launch"], r
r, e = call("list_games"); nv = next(x for x in r if x["name"] == "Fallout New Vegas"); print("fnv after:", nv["configured"], nv["profiles"])
assert nv["configured"]
assert all(d["name"] != "Fallout New Vegas" for d in call("detect_installed")[0])
print("configure:", call("configure_game", game=G))
r, e = call("list_games"); sk = next(x for x in r if x["name"] == G); print("skyrim after:", sk["configured"], sk["profiles"])
# install two mods by hand into staging, like Amethyst would
root = "/tmp/bhome/Games/Amethyst/Profiles/Skyrim Special Edition/mods"
for mod, esp, masters in [("Cool Mod", "CoolMod.esp", ["Skyrim.esm"]), ("Patch Pack", "CoolPatch.esp", ["Skyrim.esm", "CoolMod.esp"]), ("Textures HD", None, [])]:
    os.makedirs(f"{root}/{mod}/textures", exist_ok=True)
    if esp: plugin(f"{root}/{mod}/{esp}", masters)
print("mods:", call("mods", game=G, profile="default"))
for m in ["Cool Mod", "Patch Pack", "Textures HD"]:
    r, e = call("set_mod_enabled", game=G, profile="default", name=m, enabled=True); assert not e, e
print("mods enabled:", [(x["name"], x["enabled"]) for x in r])
r, e = call("move_mod", game=G, profile="default", name="Textures HD", to_index=2); print("moved:", [x["name"] for x in r], e)
r, e = call("plugins", game=G, profile="default"); print("plugins:", [(x["name"], x["enabled"], x["vanilla"], x["missing_masters"]) for x in r], e)
r, e = call("move_plugin", game=G, profile="default", name="CoolPatch.esp", to_index=0); print("move patch above master ->", e)
r, e = call("move_plugin", game=G, profile="default", name="CoolMod.esp", to_index=6); print("move master below patch ->", e)
r, e = call("set_plugin_enabled", game=G, profile="default", name="CoolMod.esp", enabled=False); print("disable CoolMod:", [(x["name"], x["enabled"], x["missing_masters"]) for x in r], e)
print("vanilla move:", call("move_plugin", game=G, profile="default", name="Skyrim.esm", to_index=3)[1])
print("disable mod -> plugins:", [ (x["name"]) for x in call("set_mod_enabled", game=G, profile="default", name="Patch Pack", enabled=False)[0] if False] or "", [(x["name"], x["enabled"]) for x in call("plugins", game=G, profile="default")[0]])
print("new profile:", call("create_profile", game=G, name="Survival"))
print("dupe profile:", call("create_profile", game=G, name="Survival")[1])
print("loot:", call("loot_sort", game=G, profile="default")[1])
print("bad method:", call("_game", name="x")[1], call("nope")[1])
print("unknown game:", call("mods", game="Nope", profile="default")[1])
p.stdin.close(); p.wait(); print("exit", p.returncode)
