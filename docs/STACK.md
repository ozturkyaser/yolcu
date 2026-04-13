# Technischer Stack (Festlegung)

Stand: Entwicklungsphase — Anpassungen nach Lasttests und Team möglich.

## Frontend (aktuell)

| Bereich | Wahl |
|---------|------|
| UI | React 19, TypeScript, Vite 6 |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`) |
| Routing | React Router 7 |
| Karte | **MapLibre GL JS** + öffentlicher Vector-Style (z. B. OpenFreeMap) |
| Schrift / Icons | Inter, Material Symbols (wie Stitch-Design) |

Später optional: **Capacitor** für iOS/Android aus derselben Codebasis, oder **Flutter** mit übernommenen Design-Tokens.

## Karten- & Routing-Daten (Ziel)

| Komponente | OSS-Empfehlung |
|------------|----------------|
| Kartendaten | OpenStreetMap (ODbL beachten) |
| Tiles / Style | Self-hosted Martin/Tileserver GL **oder** kuratierte Drittanbieter mit Lizenzprüfung |
| Routing-Engine (Backend) | OSRM, Valhalla oder GraphHopper (OSS) auf OSM-Extract EU+TR |

## Backend (geplant)

| Komponente | OSS-Empfehlung |
|------------|----------------|
| API | z. B. FastAPI, NestJS oder Go — REST + WebSockets |
| Datenbank | PostgreSQL + **PostGIS** |
| Echtzeit / Cache | **Redis** |
| Medien | **MinIO** (S3-kompatibel) |
| Auth | Keycloak, Ory oder schlanke OSS-Libs |

## Lokal (Docker)

Siehe [`docker-compose.yml`](../docker-compose.yml) und [`infra/README.md`](../infra/README.md): Postgres/PostGIS, Redis, MinIO.

## Plattform (nicht OSS, erforderlich)

- Apple **APNs** / Google **FCM** für Push-Benachrichtigungen
- App Store / Play Store für Verteilung

## CI

GitHub Actions: `npm run build` + `lint` im Ordner `app/` (siehe `.github/workflows/ci.yml`).
