#!/usr/bin/env bash
#
# scripts/ship.sh - one-command release.
#
# Bumps the version, publishes to GitHub Releases (which is what triggers
# the team's installed apps to auto-update), then commits + pushes source so
# main branch matches what's deployed.
#
# Usage:
#   bash scripts/ship.sh           # patch bump (default): 0.1.5 -> 0.1.6
#   bash scripts/ship.sh minor     # 0.1.5 -> 0.2.0
#   bash scripts/ship.sh major     # 0.1.5 -> 1.0.0
#
# Order matters: we publish to GitHub Releases BEFORE committing/pushing.
# If publishing fails (e.g., missing GH_TOKEN), the version bump can be
# discarded with `git checkout package.json` and re-tried, avoiding a
# version-skip in releases. If `git push` fails after a successful release,
# the team still gets the update; source just needs a manual catch-up.

set -euo pipefail

LEVEL="${1:-patch}"

if [ -z "${GH_TOKEN:-}" ]; then
  echo "❌ GH_TOKEN not set in this shell."
  echo "   Add 'export GH_TOKEN=ghp_...' to ~/.zshrc, then 'source ~/.zshrc'."
  exit 1
fi

# 0. Pre-ship quality gate: lint + tests. If either fails, the ship is
#    aborted before any version bump or release upload. This is the single
#    most important defense against shipping a regression that silently
#    breaks the app for users (see CHANGELOG: most user-visible breaks
#    have been static errors that ESLint catches in <1s).
echo "→ Running lint…"
if ! npm run lint --silent; then
  echo "❌ Lint failed - aborting ship. Fix the errors above and try again."
  exit 1
fi
echo "→ Running tests…"
if ! npm test --silent; then
  echo "❌ Tests failed - aborting ship."
  exit 1
fi
echo "  ✓ Pre-ship gate passed"

# 1. Bump the version
echo "→ Bumping version ($LEVEL)…"
npm version "$LEVEL" --no-git-tag-version >/dev/null
VERSION=$(node -p "require('./package.json').version")
echo "  package.json now at v$VERSION"

# 2. Build + publish to GitHub Releases - this is what triggers auto-update
#    on every installed copy
echo "→ Publishing v$VERSION to GitHub Releases (this takes ~2-3 min)…"
npm run release

# 2b. Wait for GitHub CDN to make latest-mac.yml globally readable. The
#     upload completes (electron-builder reports success) before the file
#     is reachable through GitHub's redirect/CDN layer. If we report
#     "shipped" before that, any installed app that polls in the next
#     minute hits a 404 on the manifest and surfaces a scary stack trace.
MANIFEST_URL="https://github.com/paulg7516/nowtify/releases/download/v$VERSION/latest-mac.yml"
echo "→ Waiting for CDN propagation of ${MANIFEST_URL}…"
for i in $(seq 1 36); do
  STATUS=$(curl -sL -o /dev/null -w "%{http_code}" "$MANIFEST_URL")
  if [ "$STATUS" = "200" ]; then
    echo "  Manifest reachable after $((i * 5))s"
    break
  fi
  if [ "$i" = "36" ]; then
    echo "  ⚠️  Manifest still 404 after 3 minutes - check release manually"
  fi
  sleep 5
done

# 3. Commit any pending source changes (including the version bump) and
#    push so the GitHub source matches what's shipping
echo "→ Committing + pushing source…"
git add -A
if git diff --staged --quiet; then
  echo "  Nothing to commit (source already in sync)."
else
  git commit -m "release: v$VERSION"
  git push
  echo "  Pushed."
fi

echo
echo "✅ v$VERSION shipped."
echo "   Team's installed apps will pick it up on their next launch (or within 6h)."
echo "   Release page: https://github.com/paulg7516/nowtify/releases/tag/v$VERSION"
