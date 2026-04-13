# Spezifikation: Hilfe- / Panik-Funktion („YARDIM“)

Bezug: Produktplan Abschnitt 2.9. Dieses Dokument dient Entwicklung und Abstimmung mit Jurist:innen.

## Ziele

- Nutzer können **schnell** Hilfe anfragen und **andere Nutzer in der Nähe** informieren (Opt-in-Empfänger).
- **Kein Ersatz** für Polizei, Rettung oder offizielle Leitstellen.

## UX-Ablauf (MVP)

1. Tap **YARDIM** (min. 48×48 px Zielgröße).
2. Vollbild- oder Modal-Dialog:
   - Prominenter Button **Notruf 112** (extern `tel:112` bzw. länderspezifisch, wo erlaubt).
   - Kurzwahl-Kategorien: *Panne*, *Medizinisch*, *Unsicher*, *Sonstiges*.
   - Optional: Freitext (max. Länge, z. B. 280 Zeichen).
3. Standort:
   - Erklärung in Klartext: „Dein ungefährer Standort wird für X Minuten mit Helfern in der Nähe geteilt.“
   - Auswahl: **Genau** / **nur Umkreis** (z. B. 500 m Raster) — technisch Geohash/PostGIS.
4. Bestätigung: „Hilfeanfrage senden“.
5. Feedback: „Anfrage gesendet. Bis zu N Nutzer in der Nähe wurden informiert.“

## Empfänger („Helfer in der Nähe“)

- Nur Nutzer mit **aktivem Opt-in** „Benachrichtigungen bei Hilfe in der Nähe“.
- Push + In-App-Banner; Inhalt: Kategorie, Distanz grob, **keine** exakte Adresse im Push-Text (Datenschutz).
- Link zur App: Detail nur für eingeloggte Nutzer.

## technische Leitplanken

- Server-Event `distress_signal`: Position, Kategorie, TTL, `user_id` pseudonymisiert für Logs.
- **Rate limiting** (z. B. max. 3 aktive Anfragen / 24 h pro Nutzer, konfigurierbar).
- **TTL** Sichtbarkeit Standard 30–60 Min, verlängerbar mit erneuter Einwilligung.
- Aggregation für Karten-Heatmap: **nicht** Teil von MVP.

## Missbrauch & Sicherheit

- Melden-Button auf Hilfe-Karten in der App.
- Wiederholte Falschalarme → Moderation / Sperre (Regeln in AGB).
- Audit-Log minimal: Zeit, grobe Region, User-ID (Löschung nach Frist).

## Rechtliches (Checkliste, mit Jurist klären)

- Einwilligung Art. 6 / 9 DSGVO wo nötig; TOM dokumentieren.
- AGB: Keine Garantie auf Hilfe; keine Leitstellenfunktion.
- Türkei / Drittland: Serverstandort und Übermittlung transparenz.

## Offene Punkte

- Sprachanruf 112 in Web vs. native App (Capacitor).
- Lokale Notrufnummern pro Land automatisch vorschlagen.
