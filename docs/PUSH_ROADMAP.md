# Push-Benachrichtigungen (FCM / APNs) – Roadmap

Geplant laut Produkt-Todos, **noch nicht implementiert**.

## Zielereignisse

- Hilfe / Distress (nach Zustimmung, hohe Priorität)
- Neue Community-Meldung in der **Nähe** des Nutzers
- **Gruppen-Pings** (z. B. „Wir starten in 30 Min“)

## Technische Schritte (Kurz)

1. **Firebase Cloud Messaging** (Web: VAPID-Key) oder Apple Push für spätere native Apps.
2. API: Tabelle `push_subscriptions` (user_id, endpoint, keys, created_at), `POST /api/push/register`, `DELETE` zum Abmelden.
3. API: Hintergrund-Job oder sofortiger Versand bei Events (Rate-Limits, Opt-in pro Kategorie).
4. Frontend: Service Worker + Permission-Dialog, Speichern des Tokens nach Login.

Datenschutz: Opt-in, Zweckbindung, Löschung bei Logout, Eintrag in Privacy Policy.
