#!/bin/bash
# Quit Nowtify and remove the old copy so the NinjaOne install can run.
# Records who had it running so the status check can reopen it for them.
# Settings and Jira / Microsoft 365 connections live outside the app and are kept.
APP="/Applications/Nowtify.app"
EXE="$APP/Contents/MacOS/Nowtify"
MARKER="/var/tmp/nowtify-reopen-uids"

running_uids() {
  ps -axo uid=,comm= | awk -v exe="$EXE" '{uid=$1; $1=""; sub(/^ +/,""); if ($0==exe) print uid}' | sort -u
}

if [ ! -d "$APP" ]; then
  rm -f "$MARKER"
  echo "Nowtify not installed, nothing to remove"
  exit 0
fi

# Remember which accounts had Nowtify running
running_uids > "$MARKER"
if [ -s "$MARKER" ]; then
  echo "Nowtify was running for uid(s): $(tr '\n' ' ' < "$MARKER")"
else
  echo "Nowtify was not running"
fi

pkill -f "$APP/" 2>/dev/null
sleep 3
pkill -9 -f "$APP/" 2>/dev/null
if [ -n "$(running_uids)" ]; then
  echo "WARNING: Nowtify still running after close"
fi

rm -rf "$APP"
if [ -d "$APP" ]; then
  echo "FAILED: could not remove $APP"
  exit 1
fi
echo "Removed old Nowtify"
