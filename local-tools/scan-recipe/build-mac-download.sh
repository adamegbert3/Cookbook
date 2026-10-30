#!/bin/bash
set -euo pipefail
repo_dir="$(cd "$(dirname "$0")/../.." && pwd)"
output_dir="${1:?Provide an output directory}"
mkdir -p "$output_dir"
output_dir="$(cd "$output_dir" && pwd)"
build_dir="$(mktemp -d)"
trap 'rm -rf -- "$build_dir"' EXIT
cd "$repo_dir"
app="$build_dir/image/Cookbook Scanner.app"
mkdir -p "$build_dir/image"
osacompile -s -o "$app" local-tools/scan-recipe/mac-launcher.applescript
resources="$app/Contents/Resources"
mkdir -p "$resources/cookbook/local-tools/scan-recipe" "$build_dir/node"
# Include only the public site and the scanner server, never credentials or local state.
git ls-files -z '*.html' 'scripts/*' 'styles/*' 'images/*' 'admin/*' 'offline_features/*' 'sw.js' | while IFS= read -r -d '' file; do
  mkdir -p "$resources/cookbook/$(dirname "$file")"
  cp "$file" "$resources/cookbook/$file"
done
cp local-tools/scan-recipe/serve-locally.mjs "$resources/cookbook/local-tools/scan-recipe/"
cp local-tools/scan-recipe/mac-launcher.mjs "$resources/"
# Official Node runtime, pinned by the published SHA256 manifest for this build.
curl --fail --location --retry 3 https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o "$build_dir/node/SHASUMS256.txt"
archive="$(awk '$2 ~ /^node-v22\.[0-9]+\.[0-9]+-darwin-arm64\.tar\.gz$/ {print $2}' "$build_dir/node/SHASUMS256.txt")"
[ -n "$archive" ] && [ "$(printf '%s\n' "$archive" | wc -l | tr -d ' ')" = 1 ]
curl --fail --location --retry 3 "https://nodejs.org/dist/latest-v22.x/$archive" -o "$build_dir/node/$archive"
(cd "$build_dir/node"; grep "  $archive\$" SHASUMS256.txt | shasum -a 256 -c -)
tar -xzf "$build_dir/node/$archive" -C "$build_dir/node"
node_dir="$build_dir/node/${archive%.tar.gz}"
cp "$node_dir/bin/node" "$resources/node"
cp "$node_dir/LICENSE" "$resources/Node-LICENSE.txt"
chmod +x "$resources/node"
printf '%s\n' "$archive" > "$resources/Node-version.txt"
# Local integrity signature only: this is not a Developer ID or notarized build.
codesign --force --sign - "$resources/node"
codesign --force --sign - "$app"
codesign --verify --deep --strict "$app"
ln -s /Applications "$build_dir/image/Applications"
printf '%s\n' 'Drag Cookbook Scanner to Applications, then open it. Requires Apple silicon (M1–M4 or newer) and macOS 14+.' 'Install Ollama from https://ollama.com/download/mac if prompted. The model downloads through an in-app button.' 'This community build is not notarized. macOS may require your approval under System Settings > Privacy & Security. No Terminal commands are required.' > "$build_dir/image/Read me.txt"
hdiutil create -volname 'Cookbook Scanner' -srcfolder "$build_dir/image" -ov -format UDZO "$output_dir/Cookbook-Scanner-Apple-Silicon.dmg"
hdiutil verify "$output_dir/Cookbook-Scanner-Apple-Silicon.dmg"
(cd "$output_dir"; shasum -a 256 Cookbook-Scanner-Apple-Silicon.dmg > SHA256SUMS.txt)
