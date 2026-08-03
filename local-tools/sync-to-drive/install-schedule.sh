#!/bin/bash
# ==========================================================================
# Schedule the Drive sync to run automatically on this Mac.
#
# Why launchd and not cron: launchd is what macOS actually uses, and unlike
# cron it will catch up on a missed run if the Mac was asleep at the
# scheduled time (RunAtLoad + StartCalendarInterval). A laptop that's shut
# at 2am would simply never sync under cron.
#
# Usage:
#   ./install-schedule.sh          # sync daily at 2:00 AM (default)
#   ./install-schedule.sh 6        # sync daily at 6:00 AM
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

HOUR="${1:-2}"

if ! [[ "$HOUR" =~ ^[0-9]+$ ]] || [ "$HOUR" -gt 23 ]; then
    echo "Hour must be a number from 0-23 (e.g. 2 for 2 AM, 14 for 2 PM)."
    exit 1
fi

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
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>$HOUR</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>RunAtLoad</key>
    <false/>
    <key>StandardOutPath</key>
    <string>$LOG_DIR/sync.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/sync-error.log</string>
</dict>
</plist>
PLIST_EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

printf -v PRETTY_HOUR "%02d:00" "$HOUR"
echo "✅ Drive sync scheduled daily at $PRETTY_HOUR."
echo "   Logs:   $LOG_DIR/sync.log"
echo "   Run now: launchctl start $LABEL"
echo "   Remove:  ./install-schedule.sh --remove"
echo ""
echo "Note: this only runs while this Mac is powered on and signed in."
