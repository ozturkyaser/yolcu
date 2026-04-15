#!/usr/bin/env bash
# Installiert den Git-Hook `post-merge`, der nach `git pull` automatisch
# `./scripts/docker-full-rebuild.sh` ausführt (Standard: prod).
#
# Einmal auf dem Server im Repo-Root:
#   chmod +x scripts/install-server-post-pull-rebuild-hook.sh
#   ./scripts/install-server-post-pull-rebuild-hook.sh
#
# Optional: Dev-Compose statt Prod:
#   SERVER_DOCKER_REBUILD_MODE=dev ./scripts/install-server-post-pull-rebuild-hook.sh

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/scripts/git-hooks/post-merge-docker-rebuild"
DST="$ROOT/.git/hooks/post-merge"

if [[ ! -d "$ROOT/.git" ]]; then
  echo "Kein .git unter $ROOT — nur in einem normalen Git-Klon ausführen." >&2
  exit 1
fi
if [[ ! -f "$SRC" ]]; then
  echo "Hook-Quelle fehlt: $SRC" >&2
  exit 1
fi

cp "$SRC" "$DST"
chmod 0755 "$DST"
echo "Installiert: $DST"
echo "Nach jedem erfolgreichen \`git pull\` wird ausgeführt: bash scripts/docker-full-rebuild.sh \${SERVER_DOCKER_REBUILD_MODE:-prod}"
