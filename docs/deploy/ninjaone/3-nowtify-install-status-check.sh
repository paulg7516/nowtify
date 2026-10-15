#!/bin/bash
# Confirm the expected version is installed cleanly, make it IT-managed
# (owned by the system, so only NinjaOne updates it), then quietly reopen
# Nowtify in the menu bar for the signed-in user if it was running before.
APP="/Applications/Nowtify.app"
EXE="$APP/Contents/MacOS/Nowtify"
EXPECTED="0.7.2"
MARKER="/var/tmp/nowtify-reopen-uids"

running_uids() {
  ps -axo uid=,comm= | awk -v exe="$EXE" '{uid=$1; $1=""; sub(/^ +/,""); if ($0==exe) print uid}' | sort -u
}

if [ ! -d "$APP" ]; then
  echo "FAILED: Nowtify is not installed - run Nowtify macOS $EXPECTED again"
  exit 1
fi

VERSION=$(defaults read "$APP/Contents/Info" CFBundleShortVersionString 2>/dev/null)
if [ "$VERSION" != "$EXPECTED" ]; then
  echo "FAILED: found version '$VERSION', expected $EXPECTED"
  exit 1
fi

if [ -d "$APP/Nowtify.app" ]; then
  echo "FAILED: a second copy is nested inside the app"
  exit 1
fi

chown -R root:wheel "$APP"
echo "OK: Nowtify $VERSION installed cleanly, managed by IT"

# Reopen in the background (menu bar icon only, no window)
if [ -f "$MARKER" ]; then
  CONSOLE_UID=$(stat -f%u /dev/console)
  CONSOLE_USER=$(stat -f%Su /dev/console)
  if [ -n "$(running_uids)" ]; then
    echo "Nowtify already running, left as is"
  elif [ "$CONSOLE_USER" != "root" ] && grep -qx "$CONSOLE_UID" "$MARKER"; then
    launchctl asuser "$CONSOLE_UID" sudo -u "$CONSOLE_USER" open -g -j "$APP"
    echo "Reopened Nowtify in the menu bar for $CONSOLE_USER"
  else
    echo "Nowtify was not running for the signed-in user, not reopened"
  fi
  rm -f "$MARKER"
fi
