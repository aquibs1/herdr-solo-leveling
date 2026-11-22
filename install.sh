#!/usr/bin/env bash
# Installs the Solo Leveling theme for Herdr into ~/.config/herdr-app
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.config/herdr-app"
mkdir -p "$DEST"/{themes,layouts,mods,backgrounds,data}
cp "$SRC"/themes/*.json "$DEST/themes/"
cp "$SRC"/layouts/*.json "$DEST/layouts/"
cp "$SRC"/backgrounds/* "$DEST/backgrounds/"
cp -R "$SRC"/mods/* "$DEST/mods/"
cp -R "$SRC"/data/* "$DEST/data/"
chmod +x "$DEST"/mods/sl-system/*.sh
echo "Installed. Restart Herdr, then switch layout with cmd-shift-l and pick 'solo-leveling'."
echo "Optional: add  \"layout:solo-leveling\": { \"cmd-shift-s\": \"sl-system.home\" }  to $DEST/keys.json"
