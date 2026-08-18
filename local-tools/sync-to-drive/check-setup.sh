#!/bin/bash
# Checks whether Google Drive sync is set up yet, and tells you exactly what
# to do next — one step at a time, in order. Deliberately plain bash (no
# Node.js required to run this check itself) since "is Node even installed"
# is one of the things being checked.
#
# Usage — copy/paste this whole line into Terminal, from anywhere:
#   bash "/Users/adamegbert/Documents/FOR VSCode/Cookbook/local-tools/sync-to-drive/check-setup.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo ""
echo "🔍 Checking your Google Drive sync setup..."
echo ""

# 1. Node.js — everything else depends on this
if command -v node >/dev/null 2>&1; then
    echo "✅ Node.js is installed ($(node -v))"
else
    echo "❌ Node.js is NOT installed."
    echo "   → Go to https://nodejs.org, download the LTS version, install it,"
    echo "     then close and reopen Terminal and run this check again."
    echo ""
    echo "Stopping here — everything else needs Node.js first."
    echo ""
    exit 0
fi

# 2. npm dependencies
if [ -d "$SCRIPT_DIR/node_modules" ]; then
    echo "✅ Dependencies are installed"
else
    echo "❌ Dependencies are NOT installed yet."
    echo "   → Run these two lines:"
    echo "       cd \"$SCRIPT_DIR\""
    echo "       npm install"
fi

# 3. credentials.json — the Google Cloud Console OAuth file
if [ -f "$SCRIPT_DIR/credentials.json" ]; then
    echo "✅ credentials.json found (the Google Cloud Console step is done)"
else
    echo "❌ credentials.json is MISSING."
    echo "   → This comes from Google Cloud Console — the fiddliest part of setup."
    echo "     See 'One-time setup' step 2 in README.md, or ask Claude to walk"
    echo "     you through it screen by screen."
fi

# 4. Firebase service account key (reused from local-tools/add-user, or its own copy)
if [ -f "$SCRIPT_DIR/serviceAccountKey.json" ] || [ -f "$SCRIPT_DIR/../add-user/serviceAccountKey.json" ]; then
    echo "✅ Firebase service account key found"
else
    echo "❌ Firebase service account key is MISSING."
    echo "   → Needed from local-tools/add-user — see README.md step 3."
fi

# 5. token.json — proof you've signed in to Google before
if [ -f "$SCRIPT_DIR/token.json" ]; then
    echo "✅ Already signed in to Google Drive (won't need to sign in again)"
else
    echo "⏳ Not signed in to Google Drive yet — happens automatically the first"
    echo "   time you run 'npm start', once everything above is ✅."
fi

# 6. Scheduled to run automatically in the background?
if launchctl list 2>/dev/null | grep -q "com.cookbook.drivesync"; then
    echo "✅ Scheduled to run automatically in the background"
else
    echo "⏳ Not scheduled to run automatically yet (that's install-schedule.sh —"
    echo "   the last step, after everything above is working)."
fi

echo ""
echo "👉 Copy everything above this line and send it back — that's enough to"
echo "   know exactly what to do next."
echo ""
