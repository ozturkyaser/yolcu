#!/usr/bin/env bash
# Alles neu kompilieren und den Stack neu starten:
#   1) API + App lokal: npm ci + npm run build (TypeScript / Vite)
#   2) Docker: compose down → build --no-cache → up -d
#
# Repository-Root:
#   chmod +x scripts/restart-rebuild-all.sh
#   ./scripts/restart-rebuild-all.sh           # docker-compose.yml
#   ./scripts/restart-rebuild-all.sh prod      # docker-compose.prod.yml
#
# Ohne lokales npm (nur Docker neu bauen):
#   SKIP_LOCAL_NPM=1 ./scripts/restart-rebuild-all.sh
#
# Ohne Docker (nur lokale Builds):
#   SKIP_DOCKER=1 ./scripts/restart-rebuild-all.sh
#
# Eigene Compose-Datei (nur Docker-Teil):
#   COMPOSE_FILE=docker-compose.custom.yml ./scripts/restart-rebuild-all.sh

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

if [[ "${SKIP_DOCKER:-0}" != "1" ]] && [[ ! -f "$FILE" ]]; then
  echo "Compose-Datei nicht gefunden: $FILE" >&2
  exit 1
fi

if [[ "${SKIP_LOCAL_NPM:-0}" != "1" ]]; then
  echo "==> API: npm ci && npm run build"
  (cd api && npm ci && npm run build)
  echo "==> App: npm ci && npm run build"
  (cd app && npm ci && npm run build)
else
  echo "==> SKIP_LOCAL_NPM=1 — lokale npm-Builds übersprungen"
fi

if [[ "${SKIP_DOCKER:-0}" != "1" ]]; then
  echo "==> Docker ($FILE): Stack stoppen"
  docker compose -f "$FILE" down
  echo "==> Docker: Images neu bauen (--no-cache)"
  docker compose -f "$FILE" build --no-cache
  echo "==> Docker: Container starten"
  docker compose -f "$FILE" up -d --force-recreate
  echo "==> Status:"
  docker compose -f "$FILE" ps
else
  echo "==> SKIP_DOCKER=1 — Docker-Schritte übersprungen"
fi

echo "==> Fertig."
