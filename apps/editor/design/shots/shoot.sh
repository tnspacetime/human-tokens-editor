#!/bin/zsh
# Takes Fold MD's feature screenshots: a debug build, set up by its own test
# hooks (shots.swift), on the demo's plain stage (../demo/backdrop.swift),
# with the demo's document (../demo/Basel.md).
# Output: build/shots/raw/<n>-<name>.png, Retina, the band between the menu
# bar and the Dock (3456 x 1944). make-web.sh turns them into the site's.
#
#   apps/editor/design/shots/shoot.sh
#
# Needs: Screen Recording permission for the app that runs it; the site on
# localhost:3100 (`bun run dev` in apps/site) for the publishing shot, which
# connects a throwaway test account and removes it after. Don't touch the
# Mac while it runs (about a minute).
set -e
here=${0:A:h}
demo=$here/../demo
root=${here:h:h:h:h}
out=$root/build/shots
app="$root/build/DerivedData/Build/Products/Debug/Fold MD Dev.app"
log=$(getconf DARWIN_USER_TEMP_DIR)foldmd-probe.log
library="$HOME/Library/Application Support/Fold MD Dev/series.json"
tester="Lena Hart"
mkdir -p $out/bin $out/take $out/raw

swiftc -O -o $out/bin/shots $here/shots.swift
swiftc -O -o $out/bin/backdrop $demo/backdrop.swift

# Fold MD's settings and your series list for the shoot; yours come back
# afterwards, whatever happens.
defaults export md.fold.app.dev $out/prefs-before.plist
[[ -f $library ]] && cp $library $out/series-before.json
restore() {
  pkill -f "Debug/Fold MD Dev.app/Contents/MacOS/Fold MD Dev" || true
  sleep 0.5
  defaults import md.fold.app.dev $out/prefs-before.plist
  if [[ -f $out/series-before.json ]]; then cp $out/series-before.json $library; else rm -f $library; fi
  node $here/connect.mjs remove "$tester" >/dev/null 2>&1 || true
  kill $backdrop 2>/dev/null || true
}
trap restore EXIT
trap 'exit 1' INT TERM HUP
echo '[]' > $library
defaults write md.fold.app.dev sheet.open -bool true
defaults write md.fold.app.dev sheet.height -float 330
defaults write md.fold.app.dev sheet.mode under
defaults write md.fold.app.dev appearance light
defaults write md.fold.app.dev typing.pin -bool true
defaults write md.fold.app.dev page.width.2 -float 760

# A fresh copy of the document (no notes from last time), and of the series.
rm -rf $out/take && mkdir -p $out/take && cp $demo/Basel.md $out/take/Basel.md
cp -R $here/series $out/take/series
doc=$out/take/Basel.md

$out/bin/backdrop & backdrop=$!
sleep 0.6
open -n -a "$app" $doc
sleep 3.5
$out/bin/shots setup $doc
sleep 1.2

snap() { screencapture -x -R 0,51,1728,972 $out/raw/$1.png; echo "shot $1"; }
step() { $out/bin/shots $1 $doc $2; }

step under; snap 1-under
step maths; snap 2-maths
step focus; snap 3-focus
step notes; snap 4-notes
step page; snap 5-page

# Publishing: connect the test account, choose its author name, get to the
# publish step with the pledge ticked; then let it all go again.
publish() { step publish "$1"; sleep 1.8; }
status() { tail -1 $log; }
: > $log
publish start
code=$(grep -o 'user_code: "[A-Z0-9]*"' $log | tail -1 | cut -d'"' -f2)
[[ -n $code ]] || { echo "no connect code: $(status)"; exit 1; }
node $here/connect.mjs approve $code "$tester"
for _ in {1..20}; do publish status; status | grep -q 'step=Optional([^ ]*\.author' && break; sleep 1; done
publish "author $tester,lenahart"
for _ in {1..20}; do publish status; status | grep -q 'step=Optional([^ ]*\.publish' && break; sleep 1; done
publish pledge
sleep 0.6; snap 6-publish
publish cancel
publish disconnect

step dark; snap 7-dark
step light
step series "$out/take/series|Sums that surprise"; snap 8-series
step seriesEnd "$out/take/series|Sums that surprise"

echo "shots in $out/raw"
