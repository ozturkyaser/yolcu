#!/usr/bin/env bash
# Nur Docker: Images ohne Cache neu bauen und Stack neu starten.
# Für lokales npm (api/app) + Docker zusammen: scripts/restart-rebuild-all.sh
#
# Vollständiger Neuaufbau aller Docker-Images (ohne Cache) und Neustart der Stack-Datei.
#
# Verwendung (Repository-Root):
#   chmod +x scripts/docker-full-rebuild.sh
#   ./scripts/docker-full-rebuild.sh              # docker-compose.yml (lokal: Postgres, API, …)
#   ./scripts/docker-full-rebuild.sh prod         # docker-compose.prod.yml (API + Web + Caddy)
#
# Optional: eigene Compose-Datei
#   COMPOSE_FILE=docker-compose.custom.yml ./scripts/docker-full-rebuild.sh

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE="${1:-dev}"
if [[ "$MODE" == "prod" ]]; then
  FILE="docker-compose.prod.yml"
  if [[ -z "${VITE_APP_BUILD_NUMBER:-}" ]] && git -C "$ROOT" rev-parse --is-inside-work-tree &>/dev/null; then
    VITE_APP_BUILD_NUMBER="$(git -C "$ROOT" rev-list --count HEAD)"
    export VITE_APP_BUILD_NUMBER
  fi
else
  FILE="${COMPOSE_FILE:-docker-compose.yml}"
fi

if [[ ! -f "$FILE" ]]; then
  echo "Compose-Datei nicht gefunden: $FILE" >&2
  exit 1
fi

echo "==> Compose: $FILE — Stack stoppen"
docker compose -f "$FILE" down
echo "==> Compose: $FILE (build --no-cache)"
docker compose -f "$FILE" build --no-cache
echo "==> Stack neu starten"
docker compose -f "$FILE" up -d --force-recreate
echo "==> Fertig. Status:"
docker compose -f "$FILE" ps
