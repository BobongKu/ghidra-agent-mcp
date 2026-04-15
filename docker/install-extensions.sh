#!/bin/bash
# Install Ghidra extensions from /extensions volume
set -e

GHIDRA="${GHIDRA_INSTALL_DIR:-/opt/ghidra}"
EXT_DIR="$GHIDRA/Ghidra/Extensions"

echo "Installing extensions..."

for ext in /extensions/*.zip; do
    [ -f "$ext" ] || continue
    name=$(basename "$ext" .zip)
    echo "  Installing: $name"
    unzip -qo "$ext" -d "$EXT_DIR/"
done

for ext in /extensions/*/; do
    [ -d "$ext" ] || continue
    name=$(basename "$ext")
    echo "  Copying: $name"
    cp -r "$ext" "$EXT_DIR/"
done

echo "Extensions installed."
