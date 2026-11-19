#!/bin/zsh
# Turns shoot.sh's Retina shots (build/shots/raw, 3456 x 1944) into the ones
# the site and the READMEs use, in apps/site/public/shots: WebP, each at a
# large and a small width. The window alone is cropped 4:3 around it; the
# wide ones (the page beside, dark) keep the whole 16:9 band; publish is
# closer, around its sheet.
#
#   apps/editor/design/shots/make-web.sh
#
# Needs cwebp (brew install webp).
set -e
here=${0:A:h}
root=${here:h:h:h:h}
raw=$root/build/shots/raw
web=$root/apps/site/public/shots
mkdir -p $web

# out name, raw shot, crop in raw pixels (x y width height), the two widths.
shots=(
  "under   1-under   432 0 2592 1944  1600 800"
  "maths   2-maths   432 0 2592 1944  1600 800"
  "focus   3-focus   432 0 2592 1944  1600 800"
  "notes   4-notes   432 0 2592 1944  1600 800"
  "page    5-page    0 0 3456 1944    2560 1280"
  "publish 6-publish 928 368 1600 1200 1600 800"
  "dark    7-dark    0 0 3456 1944    2560 1280"
  "series  8-series  172 0 2592 1944  1600 800"
)

for line in $shots; do
  read name shot x y w h large small <<< $line
  for width in $large $small; do
    cwebp -quiet -q 86 -m 6 -sharp_yuv -crop $x $y $w $h -resize $width 0 \
      $raw/$shot.png -o $web/$name-$width.webp
  done
  echo "$name: $(du -h $web/$name-$large.webp | cut -f1) / $(du -h $web/$name-$small.webp | cut -f1)"
done
