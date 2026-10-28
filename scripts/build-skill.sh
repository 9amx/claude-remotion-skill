#!/bin/sh
# Rebuild the .skill files (the Claude Desktop install artifacts) from the
# skill folders. Run after ANY edit to a skill.
set -e
cd "$(dirname "$0")/.."
for skill in remotion-motion-graphics faceless-video-editor; do
  rm -f "$skill.skill"
  zip -qr "$skill.skill" "$skill" \
    -x "*.DS_Store" "*/node_modules/*" "*/out/*" "*/build/*" "*/.whisper/*" "*/__pycache__/*"
  echo "rebuilt $skill.skill:"
  unzip -l "$skill.skill"
done
