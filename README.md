# Application – Yol Arkadaşım / Gurbet-Reise-Community

Monorepo-ähnliche Struktur:

| Ordner | Inhalt |
|--------|--------|
| [`app/`](app/) | React-Web-UI (Stitch-Design, MapLibre, Auth, Community, Hilfe) |
| [`api/`](api/) | Fastify-REST-API (JWT, Postgres) |
| [`stitch/`](stitch/) | Original-Stitch-HTML-Exports & Design-Doku |
| [`docs/`](docs/) | [PRODUCT.md](docs/PRODUCT.md), Stack, MVP, Spezifikationen |
| [`infra/`](infra/) | Docker & Dienste |

## Alles neu kompilieren & Docker neu starten

Im Repository-Root (neben `docker-compose.yml`):

```bash
chmod +x scripts/restart-rebuild-all.sh scripts/docker-full-rebuild.sh
./scripts/restart-rebuild-all.sh          # api+app: npm ci + build, dann docker-compose.yml
./scripts/restart-rebuild-all.sh prod     # dasselbe für docker-compose.prod.yml
```

- **`restart-rebuild-all.sh`:** lokales **`npm ci` + `npm run build`** in `api/` und `app/`, danach **`docker compose down`**, **`build --no-cache`**, **`up -d`**.  
  Nur Docker ohne lokales npm: `SKIP_LOCAL_NPM=1 ./scripts/restart-rebuild-all.sh`  
  Nur lokale Builds ohne Docker: `SKIP_DOCKER=1 ./scripts/restart-rebuild-all.sh`

**Nur Docker** (ohne lokales npm im Repo):

```bash
./scripts/docker-full-rebuild.sh          # docker-compose.yml
./scripts/docker-full-rebuild.sh prod     # docker-compose.prod.yml
```

Entspricht `docker compose down`, `build --no-cache` und `up -d --force-recreate`.

**Server nach `git pull`:** optional den Hook installieren: `./scripts/install-server-post-pull-rebuild-hook.sh` (führt danach automatisch `./scripts/docker-full-rebuild.sh` aus). Bei Push auf `main` kann zusätzlich der Workflow **Deploy DigitalOcean** (GitHub Actions) dasselbe auf der Droplet auslösen, sofern die Secrets gesetzt sind.

## Voller lokaler Start (UI + API + DB)

```bash
# 1) Datenbank, Redis, MinIO, API
docker compose up -d --build

# 2) Web (nutzt Vite-Proxy /api → localhost:4000)
cd app && npm install && npm run dev
```

**Wenn die App nicht startet:** immer aus **`app/`** starten (`cd app`), nicht im Repo-Root. Port **5173** belegt → Vite weicht automatisch auf den nächsten freien Port aus (`strictPort: false`). Fehlende Module: `cd app && rm -rf node_modules && npm install`. Ohne laufende API zeigt die Karte/Login ggf. Fehler – API auf Port **4000** starten oder Docker-Stack nutzen.

**Ortssuche (Nominatim):** In `docker-compose.yml` ist `GEOCODING_USER_AGENT` mit Default gesetzt; für Produktion eine **echte Kontakt-URL oder E-Mail** eintragen, sonst antwortet OSM oft mit **403**. Lokal ohne Docker: `GEOCODING_USER_AGENT` in `api/.env` setzen.

- Web: **http://localhost:5173**  
- API: **http://localhost:4000/api/health**  
- Erster Start: API legt Tabellen an (`INIT_DB=true`) und seedet Grenze `horgos`.
- **Karten-Simulation (optional):** In `api/.env` zusätzlich `SEED_MAP_SIMULATION=true` setzen und API starten. Es werden fünf Nutzer (`sim-anna@yol.local` … `sim-elif@yol.local`, Passwort `sim123456`), drei Gruppen (Codes `SIMKON01`, `SIMGRE01`, `SIMFAM01`) und Live-Positionen um Berlin angelegt. In der App (Testmodus) steht derselbe Hinweis im Routen-Panel.

**Nur UI gegen lokale API ohne Docker-API:** Postgres per Docker, API manuell:

```bash
docker compose up -d postgres
cd api && cp .env.example .env && npm install && npm run dev
cd app && npm run dev
```

(`api/.env`: `DATABASE_URL=postgresql://yol:yol_dev_change_me@localhost:5432/yol`, `JWT_SECRET` min. 16 Zeichen.)

**Vignetten:** Optional `STRIPE_SECRET_KEY`, `PUBLIC_WEB_APP_URL` (Checkout-Redirect), SMTP + `MAIL_FROM` + `VIGNETTE_ADMIN_EMAIL` – siehe `api/.env.example`. Ohne Stripe zeigt das Profil Anfragen ohne „Jetzt bezahlen“; ohne SMTP werden E-Mails nur geloggt.

**KI:** Für Navigation und Gruppenchat setze `AI_API_KEY` und optional `AI_MODEL` / `AI_BASE_URL` (OpenAI-kompatibel). Ohne Key antwortet die API mit einer statischen Fallback-Zusammenfassung. Gruppen-KI liest Textnachrichten und optional gespeicherte frühere KI-Antworten (`assistant_memory`, automatisch angelegt).

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
