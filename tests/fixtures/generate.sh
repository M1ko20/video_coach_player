#!/bin/sh
# Generates the small video files used by the end-to-end tests. Requires ffmpeg.
# WebM/VP9 is used because Playwright's Chromium build has no H.264 decoder.
set -e
cd "$(dirname "$0")"

# 6 s, 16:9, 25 fps — the main clip. testsrc2 shows a running frame counter.
[ -f clip-25fps.webm ] || ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "testsrc2=size=640x360:rate=25:duration=6" \
  -f lavfi -i "sine=frequency=440:duration=6" \
  -c:v libvpx-vp9 -b:v 600k -g 25 -pix_fmt yuv420p -c:a libopus -b:a 32k clip-25fps.webm

# 4 s, 4:3, 30 fps — a different aspect ratio and frame rate.
[ -f clip-30fps-4x3.webm ] || ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "testsrc2=size=480x360:rate=30:duration=4" \
  -c:v libvpx-vp9 -b:v 500k -g 30 -pix_fmt yuv420p clip-30fps-4x3.webm

# A file with a video extension and type that is not a video at all.
[ -f corrupt.webm ] || head -c 65536 /dev/urandom > corrupt.webm

[ -f notes.txt ] || echo "This is not a video." > notes.txt
