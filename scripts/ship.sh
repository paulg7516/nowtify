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

# 1. Bump the version
echo "→ Bumping version ($LEVEL)…"
npm version "$LEVEL" --no-git-tag-version >/dev/null
VERSION=$(node -p "require('./package.json').version")
echo "  package.json now at v$VERSION"

# 2. Build + publish to GitHub Releases - this is what triggers auto-update
#    on every installed copy
echo "→ Publishing v$VERSION to GitHub Releases (this takes ~2-3 min)…"
npm run release

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
