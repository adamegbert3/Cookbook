#!/bin/bash
# ==========================================================================
# Schedule the Drive sync to run automatically on this Mac, as a safety net
# behind the on-demand sync that now fires by itself right after you save,
# approve, or delete a recipe from the local admin console (see
# scripts/drive-sync-trigger.js). This catches everything else — changes
# made from a phone on the live site, or any run that failed to trigger —
# so Drive never drifts far from Firestore even if you never touch it.
#
# Why launchd and not cron: launchd is what macOS actually uses, and unlike
# cron it will catch up on a missed run if the Mac was asleep at the
# scheduled time (RunAtLoad + StartInterval). A laptop that's shut for a
# few hours would simply never sync under cron.
#
# Usage:
#   ./install-schedule.sh          # sync every 60 minutes (default)
#   ./install-schedule.sh 15       # sync every 15 minutes
#   ./install-schedule.sh --remove # stop syncing automatically
# ==========================================================================
set -e

LABEL="com.cookbook.drivesync"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"

if [ "$1" == "--remove" ]; then
    launchctl unload "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Automatic Drive sync removed. Run 'npm start' manually any time."
    exit 0
fi

MINUTES="${1:-60}"

if ! [[ "$MINUTES" =~ ^[0-9]+$ ]] || [ "$MINUTES" -lt 5 ]; then
    echo "Minutes must be a number of at least 5 (e.g. 15, 30, 60)."
    exit 1
fi
SECONDS=$((MINUTES * 60))

# launchd runs with a bare environment, so an absolute path to node is
# required — a plain "node" would not be found.
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
    echo "Could not find node. Install Node.js from https://nodejs.org first."
    exit 1
fi

if [ ! -f "$SCRIPT_DIR/token.json" ]; then
    echo "⚠️  You haven't authorised Google Drive yet."
    echo "   Run 'npm start' once first and complete the sign-in, then re-run this."
    exit 1
fi

mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_BIN</string>
        <string>$SCRIPT_DIR/sync-to-drive.mjs</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$SCRIPT_DIR</string>
    <key>StartInterval</key>
    <integer>$SECONDS</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$LOG_DIR/sync.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/sync-error.log</string>
</dict>
</plist>
PLIST_EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "✅ Drive sync scheduled every $MINUTES minutes (and once now)."
echo "   Logs:   $LOG_DIR/sync.log"
echo "   Run now: launchctl start $LABEL"
echo "   Remove:  ./install-schedule.sh --remove"
echo ""
echo "Note: this only runs while this Mac is powered on and signed in. Recipes"
echo "changed from the local admin console sync immediately regardless of this"
echo "schedule — this is just the backup for everything else."
