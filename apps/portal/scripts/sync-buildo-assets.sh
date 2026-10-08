#!/usr/bin/env bash
# Copies packages/buildo-mujoco/robots/{buildo,openarm}/ into public/mujoco-buildo/,
# preserving their exact relative layout (buildo_v0.xml's <model file="../openarm/...">
# resolves relative to its own directory, so the two directories' relative position to
# each other has to survive the copy unchanged). Also writes manifest.txt -- the
# browser can't list a directory over plain HTTP, so src/lib/mujoco/loadBuildoScene.ts
# fetches this file first to know which other files to fetch.
#
# Separate from sync-mujoco-assets.sh on purpose: that one serves the humanoid the
# live simulator actually uses today (public/mujoco/); this one is Buildo/OpenArm,
# not wired into any page yet. Keeping them as two scripts/two public/ subtrees means
# this can't accidentally clobber or interfere with the working simulator's assets.
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="../../packages/buildo-mujoco/robots"
DEST="public/mujoco-buildo/robots"

rm -rf "$DEST"
mkdir -p "$DEST"
cp -r "$SRC/buildo" "$DEST/buildo"
cp -r "$SRC/openarm" "$DEST/openarm"

# Docs/license aren't loaded by MuJoCo -- drop them so the served bundle is only
# what the browser actually needs.
find "$DEST" -iname "*.md" -delete
rm -f "$DEST/openarm/LICENSE"

# Must be generated from a completed listing (captured into a variable) before
# being written into $DEST -- writing straight into a file `find` is still
# walking would let manifest.txt list itself.
MANIFEST=$(cd "$DEST" && find . -type f | sed 's#^\./##' | sort)
echo "$MANIFEST" > "$DEST/manifest.txt"

echo "synced $(du -sh "$DEST" | cut -f1) into $DEST/ ($(echo "$MANIFEST" | wc -l) files)"
