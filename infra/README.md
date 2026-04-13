# Infrastruktur (lokal)

## Starten

Im Projektroot:

```bash
docker compose up -d
```

| Dienst    | Port  | Zweck                          |
|-----------|-------|--------------------------------|
| Postgres  | 5432  | App-Daten + PostGIS (Geodaten) |
| Redis     | 6379  | Cache, Pub/Sub, Sessions       |
| MinIO     | 9000  | S3-kompatible Objekte (Medien) |
| MinIO UI  | 9001  | Web-Konsole                    |
| API       | 4000  | Fastify (`/api/…`, JWT, Posts) |

**Standard-URLs (App später):**

- `postgresql://yol:yol_dev_change_me@localhost:5432/yol`
- `redis://localhost:6379`
- MinIO S3 API: `http://localhost:9000` (Zugangsdaten siehe `docker-compose.yml`)

Passwörter nur für **Entwicklung** — in Produktion ersetzen.

## Routing (OSRM / Valhalla) — optional

Eigene Container sind speicher- und pflegeintensiv (OSM-Extract bauen). Empfehlung:

- Später: `docker compose -f docker-compose.routing.yml` ergänzen, sobald ein EU+TR-Extract und Profil festliegen.
- Bis dahin: Routing über gehosteten OSRM/Valhalla oder manuelles CLI-Setup dokumentieren.

## Stoppen

```bash
docker compose down
```

Daten behalten: Volumes bleiben. Alles löschen:

```bash
docker compose down -v
```

## Produktion (DigitalOcean Droplet & Co.)

Siehe **[digitalocean/README.md](digitalocean/README.md)** und im Projektroot **`docker-compose.prod.yml`** (Web + API + Postgres + HTTPS).
