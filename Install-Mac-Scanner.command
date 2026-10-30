#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
project_dir="$PWD"
if [ "$(uname -s)" != Darwin ]; then
  echo 'Run this installer on your Mac.' >&2
  exit 1
fi
app_dir="$HOME/Applications/Cookbook Scanner.app"
if [ -e "$app_dir" ]; then
  marker="$app_dir/Contents/Resources/cookbook-launcher.txt"
  if [ ! -f "$marker" ] || [ "$(cat "$marker")" != cookbook-scanner ]; then
    echo 'A different app already uses ~/Applications/Cookbook Scanner.app. Move it first, then retry.' >&2
    exit 1
  fi
fi
echo 'Quit Cookbook Scanner first if it is already open. Installing its Dock launcher…'
build_dir="$(mktemp -d "${TMPDIR:-/tmp/}cookbook-app.XXXXXX")"
trap 'rm -rf -- "$build_dir"' EXIT
/usr/bin/osacompile -s -o "$build_dir/Cookbook Scanner.app" local-tools/scan-recipe/mac-launcher.applescript
resources="$build_dir/Cookbook Scanner.app/Contents/Resources"
cp local-tools/scan-recipe/mac-launcher.mjs "$resources/"
printf '%s\n' "$project_dir" > "$resources/project.path"
printf '%s\n' cookbook-scanner > "$resources/cookbook-launcher.txt"
/usr/bin/codesign --force --sign - "$build_dir/Cookbook Scanner.app"
mkdir -p "$HOME/Applications"
/usr/bin/ditto "$build_dir/Cookbook Scanner.app" "$app_dir"
echo 'Installed! Drag Cookbook Scanner from Finder into the Dock. You can now close Terminal.'
/usr/bin/open -R "$app_dir"
