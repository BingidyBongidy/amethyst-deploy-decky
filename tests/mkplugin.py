import struct, sys
def sub(t, d): return t.encode()+struct.pack("<H", len(d))+d
def plugin(path, masters, esm=False):
    body = sub("HEDR", struct.pack("<fiI", 1.71, 0, 0x800))
    for m in masters: body += sub("MAST", m.encode()+b"\0") + sub("DATA", b"\0"*8)
    hdr = b"TES4"+struct.pack("<IIIIHH", len(body), 1 if esm else 0, 0, 0, 44, 0)
    open(path,"wb").write(hdr+body)
d=sys.argv[1]
for n in ["Skyrim.esm","Update.esm","Dawnguard.esm","HearthFires.esm","Dragonborn.esm"]:
    plugin(f"{d}/{n}", [] if n=="Skyrim.esm" else ["Skyrim.esm"], esm=True)
