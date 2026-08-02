#!/usr/bin/env bash
# make-demo-gif.sh — turn the recorded demo video into a README-sized GIF.
#
# Two-pass ffmpeg palette generation (a single-pass GIF picks a generic 256-colour
# web palette and destroys Beatrice's saturated neo-brutalist colours).
#
# Usage:
#   npm run build && npm run preview &
#   node scripts/record-demo.mjs
#   ./scripts/make-demo-gif.sh
set -euo pipefail

IN="${1:-docs/demo-recording/demo.webm}"
OUT="${2:-docs/demo.gif}"
# 12fps reads as smooth motion; the crop is now a normal 816x740 region rather
# than a tall strip, so the frames are far cheaper and we can afford both a
# higher frame rate and the full duration.
FPS="${FPS:-12}"
WIDTH="${WIDTH:-800}"

# The recording is 1280x800. Crop to the app column (it is centred, with empty
# margins either side) and drop the page chrome above it.
# Format: w:h:x:y against the 1280x800 source.
CROP="${CROP:-816:740:232:60}"

# Trim: drop the landing screen at the head and most of the playback tail. The
# playhead sweep is nice but repetitive, and GIF size scales with frame COUNT ×
# frame AREA — this crop is deliberately tall, so duration is the lever.
START="${START:-1.5}"
DURATION="${DURATION:-24}"

if [[ ! -f "$IN" ]]; then
  echo "input video not found: $IN (run: node scripts/record-demo.mjs)" >&2
  exit 1
fi

PALETTE="$(mktemp -t beatrice-palette).png"
trap 'rm -f "$PALETTE"' EXIT

echo "· generating palette"
ffmpeg -loglevel error -y -ss "$START" -t "$DURATION" -i "$IN" \
  -vf "fps=${FPS},crop=${CROP},scale=${WIDTH}:-1:flags=lanczos,palettegen=stats_mode=diff" \
  "$PALETTE"

echo "· encoding gif"
ffmpeg -loglevel error -y -ss "$START" -t "$DURATION" -i "$IN" -i "$PALETTE" \
  -lavfi "fps=${FPS},crop=${CROP},scale=${WIDTH}:-1:flags=lanczos[v];[v][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle" \
  "$OUT"

SIZE_KB=$(( $(wc -c < "$OUT") / 1024 ))
echo "wrote $OUT (${SIZE_KB}KB, ${FPS}fps, ${WIDTH}px wide)"
[[ $SIZE_KB -gt 8000 ]] && echo "WARNING: >8MB — GitHub may refuse to render it inline; lower FPS or WIDTH." >&2
exit 0
