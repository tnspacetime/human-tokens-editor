#!/bin/sh
# Makes the site's icons and share picture in public/ from icon.html and
# card.html, with Google Chrome on this Mac. Run from apps/site:
#   sh brand/make.sh
# favicon.svg is written by hand and isn't made here.
set -eu

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
here="$(cd "$(dirname "$0")" && pwd)"
public="$here/../public"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# The site's own fonts, from the renderer's packages.
font() { (cd "$here/../../../packages/renderer" && node -p "require.resolve('$1')"); }
sed -e "s|{{INTER}}|file://$(font @fontsource-variable/inter/files/inter-latin-wght-normal.woff2)|" \
	-e "s|{{NEWSREADER}}|file://$(font @fontsource-variable/newsreader/files/newsreader-latin-wght-normal.woff2)|" \
	"$here/card.html" > "$work/card.html"

shot() { # shot <url> <width> <height> <out.png>
	"$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
		--user-data-dir="$work/profile" --default-background-color=00000000 \
		--window-size="$2,$3" --screenshot="$4" "$1" > /dev/null 2>&1
}

shot "file://$work/card.html" 1200 630 "$public/og.png"
shot "file://$here/icon.html?size=180&tile" 180 180 "$public/apple-touch-icon.png"
shot "file://$here/icon.html?size=192&tile" 192 192 "$public/icon-192.png"
shot "file://$here/icon.html?size=512&tile" 512 512 "$public/icon-512.png"
shot "file://$here/icon.html?size=32" 32 32 "$work/favicon-32.png"

# favicon.ico: the 32-pixel picture inside an .ico wrapper, for browsers
# and tools that ask for /favicon.ico by name.
python3 - "$work/favicon-32.png" "$public/favicon.ico" <<'EOF'
import struct, sys
png = open(sys.argv[1], "rb").read()
header = struct.pack("<HHH", 0, 1, 1)
entry = struct.pack("<BBBBHHII", 32, 32, 0, 0, 1, 32, len(png), 6 + 16)
open(sys.argv[2], "wb").write(header + entry + png)
EOF

echo "Made og.png, apple-touch-icon.png, icon-192.png, icon-512.png and favicon.ico in public/."
