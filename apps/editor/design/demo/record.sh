#!/bin/zsh
# Records the Fold MD demo: a debug build, driven by its own test hooks,
# on a plain stage. Output: build/demo/take.mov (the raw recording).
#
#   apps/editor/design/demo/record.sh
#
# Needs Screen Recording permission for the app that runs it. Don't touch
# the Mac while it records (about 50 seconds).
set -e
here=${0:A:h}
root=${here:h:h:h:h}
out=$root/build/demo
app="$root/build/DerivedData/Build/Products/Debug/Fold MD Dev.app"
mkdir -p $out/bin $out/take

swiftc -O -o $out/bin/driver $here/driver.swift
swiftc -O -o $out/bin/backdrop $here/backdrop.swift

# Fold MD's settings for the take; yours come back afterwards.
defaults export md.fold.app.dev $out/prefs-before.plist
restore() {
  defaults import md.fold.app.dev $out/prefs-before.plist
  kill $backdrop 2>/dev/null || true
}
trap restore EXIT
defaults write md.fold.app.dev sheet.open -bool true
defaults write md.fold.app.dev sheet.height -float 330
defaults write md.fold.app.dev sheet.mode under
defaults write md.fold.app.dev appearance light
defaults write md.fold.app.dev typing.pin -bool true
defaults write md.fold.app.dev page.width.2 -float 760

# A fresh copy of the document each take (no notes from the last one).
rm -f $out/take/Basel.md $out/take/.Basel.md.notes
$out/bin/driver prepare $here/Basel.md $out/take/Basel.md

$out/bin/backdrop & backdrop=$!
sleep 0.6
open -n -a "$app" $out/take/Basel.md
sleep 3.5
$out/bin/driver setup $here/Basel.md
sleep 1.2

# The band between the menu bar and the Dock, 16:9.
rm -f $out/take.mov
screencapture -v -x -V ${DEMO_SECONDS:-50} -R 0,51,1728,972 $out/take.mov & recorder=$!
sleep 0.8
$out/bin/driver play $here/Basel.md
wait $recorder

pkill -f "Debug/Fold MD Dev.app/Contents/MacOS/Fold MD Dev" || true
echo "recorded $out/take.mov"
