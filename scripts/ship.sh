#!/usr/bin/env bash
#
# scripts/ship.sh - bump version, commit, tag, push. The pushed tag triggers
# the GitHub Actions Release workflow, which builds + publishes macOS AND
# Windows to one GitHub Release. Building moved to CI; this script only does
# the version bump + tag now.
#
# Usage:
#   bash scripts/ship.sh           # patch (default)
#   bash scripts/ship.sh minor
#   bash scripts/ship.sh major

set -euo pipefail
LEVEL="${1:-patch}"

echo "Running lint..."
npm run lint --silent
echo "Running tests..."
npm test --silent
echo "  Pre-ship gate passed"

echo "Bumping version ($LEVEL)..."
npm version "$LEVEL" --no-git-tag-version >/dev/null
VERSION=$(node -p "require('./package.json').version")
echo "  package.json now at v$VERSION"

echo "Committing + tagging..."
git add -A
git commit -m "release: v$VERSION"
git tag "v$VERSION"

echo "Pushing branch + tag (this triggers the Release workflow)..."
git push
git push origin "v$VERSION"

echo
echo "v$VERSION tagged + pushed."
echo "   CI is now building macOS + Windows and will publish the GitHub Release."
echo "   Watch: https://github.com/paulg7516/nowtify/actions"
echo "   Release will appear at: https://github.com/paulg7516/nowtify/releases/tag/v$VERSION"
