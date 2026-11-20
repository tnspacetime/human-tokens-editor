#!/bin/zsh
# Release Fold MD on GitHub, where every copy of it looks for new versions
# (FoldMD/Updates.swift) and the site's Download button links (apps/site:
# lib/editor.ts). The site isn't touched.
#
#   apps/editor/release.sh "What's new, in a line or a few"
#
# First set the new version (MARKETING_VERSION) in the Xcode project, commit
# and push. The script builds a Release copy, zips it as Fold-MD.zip, writes
# latest.json (the version, the oldest macOS it opens on, the release's
# page), shows you all that, and publishes the release as fold-md-v<version>
# only when you say yes. It needs the GitHub CLI, signed in (gh auth login).
set -euo pipefail

notes=${1:-}
[[ -n $notes ]] || { echo "Say what's new: release.sh \"…\"" >&2; exit 1; }

here=${0:A:h}
root=${here:h:h}
repo=tnspacetime/human-tokens-editor
cd $root

settings=$(xcodebuild -project apps/editor/FoldMD.xcodeproj -scheme FoldMD -configuration Release -showBuildSettings 2>/dev/null)
setting() { print -r -- $settings | awk -v key=$1 '$1 == key { print $3; exit }'; }
version=$(setting MARKETING_VERSION)
minimum=$(setting MACOSX_DEPLOYMENT_TARGET)
tag=fold-md-v$version

# The release points at a commit everyone can see.
head=$(git rev-parse HEAD)
if [[ -n $(git status --porcelain -- apps/editor/FoldMD apps/editor/FoldMD.xcodeproj) ]]; then
	echo "Fold MD has changes that aren't committed. Commit them first." >&2; exit 1
fi
git fetch --quiet origin
if ! git branch -r --contains $head | grep -q .; then
	echo "This commit isn't on GitHub yet. Push first." >&2; exit 1
fi
if gh release view $tag --repo $repo >/dev/null 2>&1; then
	echo "Fold MD $version is already released. Raise MARKETING_VERSION first." >&2; exit 1
fi

out=$root/build/release
rm -rf $out
echo "Building Fold MD $version…"
xcodebuild -project apps/editor/FoldMD.xcodeproj -scheme FoldMD -configuration Release \
	-derivedDataPath $out/DerivedData build >$out.log 2>&1 || { echo "The build failed: $out.log" >&2; exit 1; }
app="$out/DerivedData/Build/Products/Release/Fold MD.app"
built=$(defaults read "$app/Contents/Info" CFBundleShortVersionString)
[[ $built == $version ]] || { echo "Built $built, expected $version." >&2; exit 1; }

ditto -c -k --keepParent "$app" $out/Fold-MD.zip
cat >$out/latest.json <<EOF
{
  "version": "$version",
  "minimumMacOS": "$minimum",
  "page": "https://github.com/$repo/releases/tag/$tag"
}
EOF

echo
echo "Fold MD $version, for macOS $minimum or later, from commit ${head:0:7}"
echo "  $(du -h $out/Fold-MD.zip | cut -f1)  $out/Fold-MD.zip"
echo "  latest.json: $(tr -d '\n ' <$out/latest.json)"
echo "  What's new: $notes"
echo
read "answer?Publish it on GitHub now? Every copy of Fold MD will offer it. [y/N] "
[[ $answer == [yY] ]] || { echo "Not published. The files are in $out."; exit 0; }

gh release create $tag $out/Fold-MD.zip $out/latest.json --repo $repo --target $head \
	--title "Fold MD $version" --notes "$notes" --latest
echo "Released: https://github.com/$repo/releases/tag/$tag"
if ! grep -q "released: true" apps/site/src/lib/editor.ts; then
	echo "The first release: set released: true in apps/site/src/lib/editor.ts and deploy the site, so /write links the download."
fi
