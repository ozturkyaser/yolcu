# Deploy-Checkliste (DigitalOcean & Live-Tests)

- [ ] Droplet: Ubuntu LTS, Docker + Compose installiert
- [ ] Firewall: 22, 80, 443 offen
- [ ] DNS A-Record → Droplet-IP
- [ ] `.env` aus `env.example`: `DOMAIN`, `ACME_EMAIL`, `POSTGRES_PASSWORD`, `JWT_SECRET` (≥16), `CORS_ORIGIN`, `GEOCODING_USER_AGENT`
- [ ] `docker compose -f docker-compose.prod.yml up -d --build`
- [ ] `curl https://$DOMAIN/api/health` → `{"ok":true}`
- [ ] Browser: App lädt, Login/Registrierung, Karte
- [ ] Optional: `INIT_DB=false` nach erstem erfolgreichen Start
