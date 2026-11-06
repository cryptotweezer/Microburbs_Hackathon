#!/usr/bin/env sh
# Listing Lens installer for macOS and Linux.
# Downloads the latest packaged extension from GitHub Releases, unpacks it to a stable folder and opens
# Chrome's extensions page. Chrome does not allow silent installs outside the Web Store, so the last
# step (Developer mode + Load unpacked) is done by the user; the script prints exactly what to click.
# Usage: curl -fsSL https://raw.githubusercontent.com/cryptotweezer/Microburbs_Hackathon/main/install/install.sh | sh
set -eu
URL="https://github.com/cryptotweezer/Microburbs_Hackathon/releases/latest/download/listing-lens.zip"
DEST="$HOME/ListingLens"
ZIP="$(mktemp -t listing-lens.XXXXXX).zip"

echo "Downloading Listing Lens..."
curl -fsSL "$URL" -o "$ZIP"
rm -rf "$DEST" && mkdir -p "$DEST"
unzip -q "$ZIP" -d "$DEST" && rm -f "$ZIP"
[ -f "$DEST/manifest.json" ] || { echo "Download looks incomplete: manifest.json not found in $DEST" >&2; exit 1; }

if [ "$(uname)" = "Darwin" ]; then
  printf %s "$DEST" | pbcopy 2>/dev/null || true
  open -a "Google Chrome" "chrome://extensions" 2>/dev/null || true
  open "$DEST"
else
  (google-chrome "chrome://extensions" >/dev/null 2>&1 &) || true
  xdg-open "$DEST" >/dev/null 2>&1 || true
fi

echo ""
echo "Listing Lens is ready in $DEST"
echo "In the Chrome tab that just opened:"
echo "  1. Turn on 'Developer mode' (top right)."
echo "  2. Click 'Load unpacked' and choose $DEST, or drag the folder onto the page."
echo "Then open any City of Sydney listing on domain.com.au or realestate.com.au and click the Listing Lens icon."
