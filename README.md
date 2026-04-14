# Application – Yol Arkadaşım / Gurbet-Reise-Community

Monorepo-ähnliche Struktur:

| Ordner | Inhalt |
|--------|--------|
| [`app/`](app/) | React-Web-UI (Stitch-Design, MapLibre, Auth, Community, Hilfe) |
| [`api/`](api/) | Fastify-REST-API (JWT, Postgres) |
| [`stitch/`](stitch/) | Original-Stitch-HTML-Exports & Design-Doku |
| [`docs/`](docs/) | [PRODUCT.md](docs/PRODUCT.md), Stack, MVP, Spezifikationen |
| [`infra/`](infra/) | Docker & Dienste |

## Voller lokaler Start (UI + API + DB)

```bash
# 1) Datenbank, Redis, MinIO, API
docker compose up -d --build

# 2) Web (nutzt Vite-Proxy /api → localhost:4000)
cd app && npm install && npm run dev
```

- Web: **http://localhost:5173**  
- API: **http://localhost:4000/api/health**  
- Erster Start: API legt Tabellen an (`INIT_DB=true`) und seedet Grenze `horgos`.

**Nur UI gegen lokale API ohne Docker-API:** Postgres per Docker, API manuell:

```bash
docker compose up -d postgres
cd api && cp .env.example .env && npm install && npm run dev
cd app && npm run dev
```

(`api/.env`: `DATABASE_URL=postgresql://yol:yol_dev_change_me@localhost:5432/yol`, `JWT_SECRET` min. 16 Zeichen.)

## Produktion / Live-Tests (DigitalOcean & Co.)

Ein Befehl: **Postgres + API + Web-UI + HTTPS (Caddy)** – siehe  
[`infra/digitalocean/README.md`](infra/digitalocean/README.md) und `docker-compose.prod.yml` im Projektroot.

Kurz:

```bash
cp infra/digitalocean/env.example .env
# .env ausfüllen (Domain, Secrets, CORS_ORIGIN, GEOCODING_USER_AGENT)
docker compose -f docker-compose.prod.yml up -d --build
```

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) — `app` (lint+build) und `api` (Typecheck).

## Android-APK (Capacitor)

Die Web-UI liegt unter [`app/`](app/) mit [Capacitor](https://capacitorjs.com/). Die fertige App lädt die gebaute `dist/`-UI in einer nativen WebView; **API und WebSockets** brauchen eine erreichbare HTTPS-URL (nicht `localhost` vom Handy aus).

1. **API-Basis setzen** (ohne trailing slash), z. B. Datei `app/.env.production`:

   ```bash
   VITE_API_BASE_URL=https://deine-domain.de
   ```

2. **Web bauen und nach Android kopieren**, dann **APK** (JDK 17+ und Android SDK bzw. Android Studio):

   ```bash
   cd app
   npm install
   npm run cap:sync
   cd android && ./gradlew assembleDebug
   ```

   Debug-APK: `app/android/app/build/outputs/apk/debug/app-debug.apk`.

   Alternativ: `npm run android:open` und in Android Studio **Build → Build Bundle(s) / APK(s) → Build APK(s)**.

3. **Release-APK** (Signierung, Play Store): in Android Studio ein Signing-Config anlegen und `assembleRelease` ausführen; siehe [Capacitor Android deploy](https://capacitorjs.com/docs/android/deploying-to-google-play).
