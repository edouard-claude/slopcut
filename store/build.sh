#!/bin/sh
# Builds the Chrome Web Store upload zip (extension files only, no store assets).
set -eu
cd "$(dirname "$0")/.."
VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json)
OUT="store/slopcut-$VERSION.zip"
rm -f "$OUT"
zip -qr "$OUT" manifest.json src popup icons -x '*.DS_Store'
echo "$OUT"
unzip -l "$OUT" | tail -1
