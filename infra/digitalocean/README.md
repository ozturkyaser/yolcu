# Live-Tests auf DigitalOcean (sofort installierbar)

Dieses Setup startet **Postgres + API + statisches Web-UI + Caddy (TLS)** in einem Rutsch – ideal für eine **Droplet**-VM mit Docker.

## Was du brauchst

- Ein **DigitalOcean**-Konto.
- Eine **Domain** (A-Record auf die Droplet-IPv4 zeigen lassen) – für HTTPS mit Let’s Encrypt.
- Alternativ nur die **Droplet-IP** zum Schnelltest (dann nur HTTP, siehe unten).

## Droplet anlegen

1. **Create → Droplets**  
   - Image: **Ubuntu 24.04 LTS**  
   - Größe: z. B. **2 GB RAM / 1 vCPU** (für erste Live-Tests ausreichend; mehr bei vielen gleichzeitigen Nutzern).  
   - **SSH-Key** hinterlegen.  
2. Nach dem Start: **Firewall / Networking**  
   - Eingehend: **22** (SSH), **80**, **443** (HTTP/HTTPS).  
3. DNS: **A-Record** `app.deine-domain.de` → **öffentliche IP** der Droplet (TTL z. B. 300 s).

## Docker auf der Droplet installieren

Per SSH einloggen, dann (offizielle Docker-Anleitung für Ubuntu, Kurzfassung):

```bash
sudo apt-get update && sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${VERSION_CODENAME:-$VERSION}") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
# neu einloggen, damit die docker-Gruppe greift
```

## Projekt ausrollen

```bash
cd /opt
sudo git clone https://github.com/DEIN-ORG/Application.git yol
sudo chown -R "$USER:$USER" yol
cd yol
cp infra/digitalocean/env.example .env
nano .env   # DOMAIN, ACME_EMAIL, Passwörter, JWT_SECRET, CORS_ORIGIN, GEOCODING_USER_AGENT
docker compose -f docker-compose.prod.yml up -d --build
```

- **`CORS_ORIGIN`** muss exakt der öffentliche Origin sein, z. B. `https://app.deine-domain.de` (ohne Slash am Ende).
- **`JWT_SECRET`**: mindestens 16 Zeichen, zufällig (z. B. `openssl rand -base64 32`).
- **`GEOCODING_USER_AGENT`**: gültige Kontaktzeile für Nominatim (siehe Kommentar in `env.example`).

Prüfen:

```bash
curl -sS https://app.deine-domain.de/api/health
# Erwartung: {"ok":true}
```

Web-App im Browser: `https://app.deine-domain.de`

**Admin (`/admin`):** Der Produktions-Docker-Build setzt `VITE_BASE=/`, damit direkte Aufrufe wie `https://…/admin` die JS/CSS unter `/assets/…` laden. Ohne das (nur `./`) wirkt die Seite online oft „leer“ bei Deep-Links. Nach Änderungen am Web-Image: `docker compose … build --no-cache web` und Container neu starten.

### Nur HTTP (ohne Domain, z. B. `http://IP`)

Let’s Encrypt braucht einen **Hostnamen**; mit reiner IP nutze das HTTP-Caddyfile und setze **`CORS_ORIGIN`** auf `http://DEINE_IP`:

```bash
export CADDYFILE=./infra/digitalocean/Caddyfile.http
# In .env: CORS_ORIGIN=http://203.0.113.7
docker compose -f docker-compose.prod.yml up -d --build
```

Dann nur Port **80** in der Firewall nötig (plus 22).

## Automatischer Docker-Neuaufbau

### Nach jedem Push auf `main` (GitHub Actions)

Im Repo ist **`.github/workflows/deploy-digitalocean.yml`** hinterlegt: bei Push auf `main` (oder manuell *workflow_dispatch*) verbindet sich GitHub per SSH mit der Droplet, macht `git pull --ff-only` und führt **`./scripts/docker-full-rebuild.sh prod`** aus (voller Neuaufbau mit `--no-cache`).

Benötigte Repository-Secrets: `DO_HOST`, `DO_USER`, `DO_SSH_KEY`, `DO_PROJECT_PATH` (absoluter Pfad zum Repo auf dem Server, z. B. `/opt/yol`).

### Nur wenn du auf dem Server manuell `git pull` machst

Optional den **Git-Hook** installieren — dann läuft nach jedem erfolgreichen Pull automatisch dasselbe Rebuild-Skript:

```bash
cd /opt/yol   # dein Klon
chmod +x scripts/install-server-post-pull-rebuild-hook.sh
./scripts/install-server-post-pull-rebuild-hook.sh
```

Standard ist **Prod** (`prod`). Für die Dev-Compose-Datei: `SERVER_DOCKER_REBUILD_MODE=dev ./scripts/install-server-post-pull-rebuild-hook.sh`.

## Logs & Neustart

```bash
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml restart api
```

## Daten & Backups

- Postgres-Daten liegen im Volume **`yol_pg_data`**.
- Sprachdateien der API im Volume **`yol_api_voice`**.
- Backups: regelmäßig `pg_dump` aus einem Sidecar-Container oder Managed Database erwägen.

## Nach dem ersten Deploy

- In `.env` kannst du **`INIT_DB=false`** setzen (optional; Migrationen sind idempotent).
- **Geheimnisse** nie committen; `.env` bleibt lokal auf dem Server.

## Alternative: DigitalOcean App Platform

Weniger SSH/Compose, dafür mehr Klick-UI: **App Platform** mit getrennten **Web**- und **API**-Komponenten und **Managed Postgres**. Dafür müsstest du Build-Commands und Umgebungsvariablen in der DO-Oberfläche eintragen – das vorliegende `docker-compose.prod.yml` ist der schnellste Weg auf einer **einzigen Droplet** mit voller Kontrolle.

## Alternative: Managed Database

Statt Container-Postgres kannst du **DigitalOcean Managed PostgreSQL** nutzen: `DATABASE_URL` in `.env` auf den DO-Connection-String setzen und den Dienst **`postgres`** aus einer angepassten Compose-Datei entfernen (nur für Fortgeschrittene).
