#!/bin/sh
# Renders header.html to the README/Labs images with headless Chrome.
set -e
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
shot() {
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size="$1" --screenshot="$PWD/../images/$2" "file://$PWD/header.html$3" >/dev/null 2>&1
}
shot 1600,640 header.png
shot 1280,640 social.png
shot 1200,630 og.png
shot 1200,620 examples.png "#rows"
