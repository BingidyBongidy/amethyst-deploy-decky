#!/bin/bash
# Builds /tmp/bhome: a fake HOME with a Steam library containing Skyrim SE
# (vanilla .esm files + a Proton prefix), for tests/bridge_smoke.py.
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
echo "fake home ready at $H"
