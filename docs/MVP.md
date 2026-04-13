# MVP – priorisierte User-Journeys

> **Hinweis:** Die Codebasis ist über dieses MVP hinaus um eine **funktionsfähige API + Auth + Community + Hilfe** erweitert worden. Überblick: [PRODUCT.md](./PRODUCT.md).

Ziel: erste nutzbare Version für eine geschlossene Testgruppe (EU → TR / innerhalb TR).

## P0 – Muss für MVP

1. **Karte**
   - MapLibre mit EU/TR-Ausschnitt, Zoom/Pan
   - Optional: Standort des Nutzers (Einwilligung)
2. **Navigation in der App**
   - Tabs: Harita, Topluluk, Profil (wie Stitch)
   - Grenz-Detail-Seite erreichbar (Stub-Daten OK)
3. **Community (minimal)**
   - Liste von Meldungen (zuerst statisch oder aus einfachem API-GET)
   - Filter-Chips (UI; Backend kann vereinfacht sein)
4. **Profil (minimal)**
   - Anzeige Name, Fahrzeug-Stub, Vignetten-Checkliste (lokal oder API)
5. **Hilfe / Panik (MVP-UX)**
   - Button sichtbar; Flow: Kategorie → optional Text → Hinweis **112** → (später) Push an Opt-in-Nutzer
6. **Rechtliches (Platzhalter)**
   - Verlinkte Datenschutz-/AGB-Seiten (Entwurf), Standort-Hinweis bei erster Karten-Nutzung

## P1 – kurz nach MVP

- Auth (E-Mail / OAuth)
- Posts erstellen (Text + Bild-Upload über MinIO)
- Gruppen + Gruppen-Chat (WebSocket)
- POIs auf der Karte

## P2

- Eigenes Routing (OSRM/Valhalla) angebunden
- Grenz-Wartezeit-Aggregation
- Booking/Airbnb Deep-Links aus der App

## Nicht im MVP

- Turn-by-Turn-Sprachnavigation
- Vollständige Offline-Karten
- Offizielle Booking-Demand-API (ohne Partnerschaft)
