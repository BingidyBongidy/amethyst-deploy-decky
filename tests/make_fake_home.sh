#!/bin/bash
# Builds /tmp/bhome: a fake HOME with a Steam library containing Skyrim SE
# (vanilla .esm files + a Proton prefix) and a Heroic GOG install of Fallout NV, for tests/bridge_smoke.py.
set -euo pipefail
H=/tmp/bhome
rm -rf "$H"
ST="$H/.local/share/Steam/steamapps"
G="$ST/common/Skyrim Special Edition"
mkdir -p "$G/Data" "$ST/compatdata/489830/pfx/drive_c"
cat > "$ST/libraryfolders.vdf" <<EOF
"libraryfolders"
{
	"0"
	{
		"path"		"$H/.local/share/Steam"
		"apps"
		{
			"489830"		"1"
		}
	}
}
EOF
cat > "$ST/appmanifest_489830.acf" <<'EOF'
"AppState"
{
	"appid"		"489830"
	"name"		"The Elder Scrolls V: Skyrim Special Edition"
	"installdir"		"Skyrim Special Edition"
}
EOF
touch "$G/SkyrimSELauncher.exe" "$G/SkyrimSE.exe"
python3 "$(dirname "$0")/mkplugin.py" "$G/Data"

# Fallout New Vegas from GOG through Heroic (native config dir), with its
# prefix in Heroic's default location - exercises non-Steam detection.
HR="$H/.config/heroic"
NV="$H/Games/Heroic/Fallout New Vegas"
mkdir -p "$HR/gog_store" "$NV/Data" "$H/Games/Heroic/Prefixes/1454587428/pfx/drive_c"
touch "$NV/FalloutNV.exe" "$NV/FalloutNVLauncher.exe"
cat > "$HR/gog_store/installed.json" <<EOF
{"installed": [{"appName": "1454587428", "platform": "windows",
  "install_path": "$NV", "executable": "FalloutNV.exe"}]}
EOF
# Valheim in the same Steam library: a Thunderstore game for the live
# download test.
VH="$ST/common/Valheim"
mkdir -p "$VH"
touch "$VH/valheim.exe"
cat > "$ST/appmanifest_892970.acf" <<'EOF'
"AppState"
{
	"appid"		"892970"
	"name"		"Valheim"
	"installdir"		"Valheim"
}
EOF
mkdir -p "$ST/compatdata/892970/pfx/drive_c"

# Archives for Install from Downloads.
mkdir -p "$H/Downloads"
python3 "$(dirname "$0")/make_archives.py" "$H/Downloads"

echo "fake home ready at $H"
