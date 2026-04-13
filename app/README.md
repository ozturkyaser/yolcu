# Yol Arkadaşım – UI (Stitch → React)

Diese App setzt die **Google-Stitch-HTML-Exports** aus [`../stitch/`](../stitch/) als **React + TypeScript + Tailwind CSS v4** um:

| Stitch-Export | React-Seite |
|---------------|-------------|
| `stitch/dashboard_map/code.html` | `src/pages/MapDashboardPage.tsx` |
| `stitch/community_feed/code.html` | `src/pages/CommunityFeedPage.tsx` |
| `stitch/profile_vehicle/code.html` | `src/pages/ProfilePage.tsx` |
| `stitch/border_details/code.html` | `src/pages/BorderDetailPage.tsx` |
| `stitch/waypoint_high_contrast/DESIGN.md` | Farben & Tokens in `src/index.css` (`@theme`) |

## Karte (MapLibre)

Die Hauptansicht nutzt **MapLibre GL JS** mit dem öffentlichen Vector-Style [OpenFreeMap „Liberty“](https://openfreemap.org/) (`src/components/MapLibreMap.tsx`). Kein API-Key nötig; für Produktion eigenen Tileserver / Style prüfen.

## Projekt-Dokumentation

| Dokument | Inhalt |
|----------|--------|
| [`../docs/STACK.md`](../docs/STACK.md) | Technischer Stack (festgelegt) |
| [`../docs/MVP.md`](../docs/MVP.md) | MVP-Prioritäten & User-Journeys |
| [`../docs/PANIC_HELP_SPEC.md`](../docs/PANIC_HELP_SPEC.md) | Spezifikation Hilfe-/Panik-Button |
| [`../infra/README.md`](../infra/README.md) | Docker-Dienste (Postgres, Redis, MinIO) |

## Voraussetzungen

- Node.js 20+

## Installation & Start

```bash
cd app
rm -rf node_modules package-lock.json
npm install
npm run dev
```

Öffne die angezeigte URL (meist `http://localhost:5173`).

## Build

```bash
npm run build
```

### Hinweis zu Vite 8 / Rolldown

Falls `vite build` mit einem **Rolldown native binding**-Fehler abbricht, ist dieses Projekt auf **Vite 6** gepinnt. Bei defekten `node_modules` (z. B. `TAR_ENTRY_ERROR`):

```bash
rm -rf node_modules package-lock.json
npm cache verify
npm install
```

## Backend & Datenbank

Voller Stack im Projektroot:

```bash
docker compose up -d --build
```

Dann startet die API auf Port **4000**; Vite leitet `/api` per Proxy weiter (`vite.config.ts`).

Details: [`../README.md`](../README.md), [`../infra/README.md`](../infra/README.md).

## Nächste Schritte (laut Produktplan)

- Backend-API anbinden (Auth, Feed, Hilfe-Button laut `PANIC_HELP_SPEC`)
- Eigenen Map-Style / Tiles hosten
- iOS/Android: z. B. **Capacitor** oder **Flutter** mit denselben Design-Tokens
