#!/usr/bin/env bash
# Pull latest research JSON (content evolves) into data/research.
set -euo pipefail
SRC="${1:-/workspace/knoglequiz/deliverables/research}"
cd "$(dirname "$0")/.."
mkdir -p data/research
for f in bones muscles tendons ligaments; do cp "$SRC/$f.json" data/research/; done
cp "$SRC/README.md" data/research/README.md
echo "synced from $SRC"
