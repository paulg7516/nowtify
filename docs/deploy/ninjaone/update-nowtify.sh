#!/bin/bash
# Install or update Nowtify on a company Mac in one step (NinjaOne, Run as System).
# Downloads the release DMG from GitHub, checks it against the release's own
# checksum, swaps the app in place (old copy restored on any failure), makes it
# IT-managed (owned by root, so users never get update pop-ups), and quietly
# reopens it in the menu bar if the signed-in user had it running.
# Safe to run again: a Mac already on this version is left alone.
VERSION="0.7.2"

REPO="https://github.com/paulg7516/nowtify/releases/download/v$VERSION"
DMG_NAME="Nowtify-$VERSION-universal.dmg"
APP="/Applications/Nowtify.app"
EXE="$APP/Contents/MacOS/Nowtify"
WORK="$(mktemp -d /tmp/nowtify-update.XXXXXX)"
MNT="$WORK/mnt"
BACKUP="/Applications/.Nowtify-previous.app"

running_uids() {
  ps -axo uid=,comm= | awk -v exe="$EXE" '{uid=$1; $1=""; sub(/^ +/,""); if ($0==exe) print uid}' | sort -u
}
version_of() {
  defaults read "$1/Contents/Info" CFBundleShortVersionString 2>/dev/null
}
cleanup() {
  hdiutil detach -quiet "$MNT" 2>/dev/null
  rm -rf "$WORK"
}
fail() {
  echo "FAILED: $1"
  cleanup
  exit 1
}
trap cleanup EXIT

# Already done?
if [ "$(version_of "$APP")" = "$VERSION" ] && [ ! -d "$APP/Nowtify.app" ]; then
  chown -R root:wheel "$APP"
  echo "OK: Nowtify $VERSION already installed, managed by IT"
  exit 0
fi

# Download and verify against the checksum GitHub publishes with the release
curl -fsSL -o "$WORK/$DMG_NAME" "$REPO/$DMG_NAME" || fail "could not download $DMG_NAME"
curl -fsSL -o "$WORK/latest-mac.yml" "$REPO/latest-mac.yml" || fail "could not download checksum file"
EXPECTED_SHA=$(grep -A1 "url: $DMG_NAME" "$WORK/latest-mac.yml" | sed -n "s/.*sha512: //p" | head -1)
ACTUAL_SHA=$(openssl dgst -sha512 -binary "$WORK/$DMG_NAME" | base64 | tr -d '[:space:]')
[ -n "$EXPECTED_SHA" ] && [ "$EXPECTED_SHA" = "$ACTUAL_SHA" ] || fail "download checksum mismatch"

mkdir -p "$MNT"
hdiutil attach -quiet -nobrowse -readonly -mountpoint "$MNT" "$WORK/$DMG_NAME" || fail "could not open DMG"
[ "$(version_of "$MNT/Nowtify.app")" = "$VERSION" ] || fail "DMG does not contain version $VERSION"

# Note who had Nowtify running, then close it
WAS_RUNNING="$(running_uids)"
if [ -n "$WAS_RUNNING" ]; then
  echo "Nowtify was running for uid(s): $(echo $WAS_RUNNING)"
  pkill -f "$APP/" 2>/dev/null
  sleep 3
  pkill -9 -f "$APP/" 2>/dev/null
fi

# Swap: keep the old copy until the new one is verified in place
rm -rf "$BACKUP"
if [ -d "$APP" ]; then
  mv "$APP" "$BACKUP" || fail "could not move old app aside"
fi
if ! ditto "$MNT/Nowtify.app" "$APP" || [ "$(version_of "$APP")" != "$VERSION" ]; then
  rm -rf "$APP"
  [ -d "$BACKUP" ] && mv "$BACKUP" "$APP"
  fail "could not install new version, previous version restored"
fi
rm -rf "$BACKUP"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null
chown -R root:wheel "$APP"
echo "OK: Nowtify $VERSION installed cleanly, managed by IT"

# Quietly reopen in the menu bar (no window) for the signed-in user if they had it running
CONSOLE_UID=$(stat -f%u /dev/console)
CONSOLE_USER=$(stat -f%Su /dev/console)
if [ "$CONSOLE_USER" != "root" ] && echo "$WAS_RUNNING" | grep -qx "$CONSOLE_UID"; then
  launchctl asuser "$CONSOLE_UID" sudo -u "$CONSOLE_USER" open -g -j "$APP"
  echo "Reopened Nowtify in the menu bar for $CONSOLE_USER"
fi
exit 0
