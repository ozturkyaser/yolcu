# Produkt: Yol Arkadaşım (funktionsfähige Basis)

## Ausgangsidee

Community für **Reisende zwischen Europa und der Türkei** (und innerhalb der Türkei): **Karte**, **Grenz- und Verkehrsinfos**, **gegenseitige Hilfe**, **Profil/Fahrzeug/Vignetten-Hinweise** – technisch mit **Open Source** (MapLibre, Postgres, Docker), später erweiterbar um Push, Routing-Server, Partner-Links.

## Perspektive Urlauber:in – allein, zu zweit oder im Konvoi

### Dieselbe Reise, unterschiedliche Realität

Viele fahren **zum gleichen Ziel** (Heimat, Urlaub, Familie), erleben auf dem Weg aber **andere Probleme**: allein fehlt der zweite Blick auf Stauschilder und Grenzabfertigung; in der Gruppe fehlen manchmal **geteilte Infos** zwischen den Autos; an der Grenze zählen **Wartezeit, Dokumente, Zoll, Maut, Vignette, Werkstatt, Sprache vor Ort**. Die App soll diese **fragmentierte Erfahrung** bündeln: **ein Ort**, an dem Reisende sich **gegenseitig stützen** und **möglichst viel Sinnvolles** auf einen Blick finden – nicht nur Meinungen im Feed, sondern **strukturierte und kontextuelle Information** (Route, Grenze, Kategorie, Zeit, Nähe).

### Gemeinschaft als Dauerzustand, nicht nur Notfall

- **Unterstützung** bedeutet: kurze **Live-Hinweise** („Schlange bewegt sich“, „links die schnellere Spur“), **geteilte Checklisten** (Pässe, Grüne Karte, ADR), **Vertrauen** durch identifizierbare Profile und Gruppen.  
- **Sinnvoll informiert** bedeutet: **Grenz- und Streckenwissen**, **Community-Meldungen mit Ort und Zeit**, später **Aggregation** („häufig gemeldet: Wartezeit > 90 min“) ohne die menschliche Stimme zu ersetzen.

### Kernfunktion: Live-Kommunikation – Stimme, Nähe, „Fahrzeuge um dich herum“

Die **wichtigste** soziale Schicht ist **Echtzeit**: unterwegs will niemand lange tippen. Deshalb:

| Idee | Richtung |
|------|----------|
| **Live-Sprache** | **Push-to-Talk / Sprachnachrichten** in Gruppen (bereits angelegt); Ausbau: **kurze Kanäle** pro Konvoi oder pro Streckenabschnitt, **Weniger Latenz**, klare **„wer spricht gerade“**-Anzeige |
| **Autos in der Nähe, mit denen man sprechen kann** | Auf der **Karte** nur bei **ausdrücklicher Einwilligung** sichtbare **Mitreisende** (bereits: freiwillige Präsenz); Ausbau: **„In Reichweite für Funk“** (z. B. gleiche Gruppe + räumliche Nähe), **direkter Sprachkanal** oder **Walkie an die Gruppe**, ohne private Kontaktdaten preiszugeben |
| **Sprache(n)** | UI und Inhalte **mehrsprachig** (DE/TR/EN als Minimum); Chat optional **Sprache der Gruppe**; später: **automatische Untertitel** für Sprachnachrichten (Barriere niedriger, Sicherheit in lauter Umgebung) |
| **Zeichen & Lesbarkeit** | **Klare Symbole** auf der Karte (Fahrzeugtyp, Gruppe, Hilfe); **kontrastreiche** Darstellung für Sonne/Nachtfahrt; rechtliche/behördliche **Hinweise als kurze, feste Bausteine** (nicht nur Fließtext) |

**Datenschutz:** Nähe-basierte Kommunikation nur mit **aktivem Opt-in**, **begrenzter Anzeigedauer**, **kein** öffentliches Tracking – technisch über **Gruppenmitgliedschaft + grobe Distanz** (bereits ähnlich: Presence-Umkreis) statt exakter Adressen.

### Informationsangebot „so viel wie möglich, aber sortiert“

- **Eine App**, statt zwischen Facebook, Maps, Messenger und PDFs zu springen.  
- **Schichten:** (1) **Kuratiert** – Grenzregeln, Vignetten, Notrufe; (2) **Community live** – Meldungen, Stimme, Gruppe; (3) **Persönlich** – Route, Fahrzeug, eigene Gruppen.  
- **Teilen** als Gewohnheit: **ein Tipp** reicht oft – die App macht daraus **wiederfindbare** Infos (Kategorie, Ort, Zeit), nicht verlorene Chatblasen.

## Was die aktuelle Codebasis leistet (nicht nur MVP-UI)

| Bereich | Funktion |
|---------|----------|
| **Karte** | MapLibre + OpenFreeMap-Style, EU/TR-Startausschnitt |
| **Grenzdetail** | Daten aus API/DB (`/api/borders/:slug`), Seed „horgos“ |
| **Auth** | Registrierung, Login, JWT, Session in `localStorage` |
| **Community** | Beiträge listen, filtern, **„Faydalı“** persistiert, **neue Meldung** (authentifiziert) |
| **Hilfe** | Modal mit **112**, Kategorie, optional Standort → **POST /api/distress** (Rate-Limit) |
| **Profil** | Anzeigename & Fahrzeug speichern (API + Postgres) |
| **Rechtliches** | Entwurfsseiten `/legal/privacy`, `/legal/terms` |
| **Gruppen & Live** | Gruppenchat, **WebSocket**, **Sprachnachrichten**, **PTT**; **Karte**: Walkie/Kurztext zur Gruppe |
| **Infrastruktur** | Docker: Postgres/PostGIS, Redis, MinIO, **API** |

## Architektur kurz

- **Frontend:** `app/` – React, Vite-Proxy `/api` → `localhost:4000`
- **Backend:** `api/` – Fastify, JWT, `pg`, SQL-Schema in `src/schema.sql`
- **DB:** Tabellen `users`, `vehicles`, `posts`, `post_helpful`, `distress_events`, `borders`

## Parallele zu Community-Seiten (z. B. „Silayolu“-Stil)

Viele Facebook-Gruppen/Seiten rund um **Heimatroute, Grenze, Konvoi und Kurzinfos** leben aus **Posts, Kommentaren und Messenger** – ohne Karte, ohne strukturierte Daten und ohne klare Notfall-Kette. Diese App kann dieselbe **soziale Energie** aufnehmen und **technisch übersetzen**:

| Soziale Seite / Gruppe (typisch) | In dieser App |
|----------------------------------|---------------|
| „Wie ist die Grenze?“ / Stau-Posts | **Community** mit Kategorie *Grenze/Verkehr* + optional **Standort**; **Grenz-Detailseiten** (z. B. Horgoš) |
| „Wer fährt wann?“ / Konvoi | **Gruppen** + **Karte** (Präsenz freiwillig) + **Walkie/Kurztext** zur schnellen Abstimmung |
| Kurze Sprach-/Text-Hinweise | **Sprachnachrichten** im Gruppenchat, **PTT** im Chat |
| Vertrauen / gleiche Leute | **Profil**, **Einladungscode**, später **Moderation** |
| Hilfe unterwegs | **Hilfe-Modal** mit 112-Hinweis und **Distress-API** (Ausbau: Push) |

**Hinweis:** Konkrete Inhalte einzelner Facebook-Seiten sind oft nicht öffentlich scrapbar; die Erweiterung richtet sich nach **üblichen Bedürfnissen** dieser Zielgruppe, nicht nach einem einzelnen Seiten-Feed.

## Nächste Ausbaustufen

### Live & Nähe (Priorität)

- **Nähe-„Funk“:** Nutzer derselben **Gruppe** in definierter **Entfernung** als „in Reichweite“ markieren; optional **PTT nur an diese Teilnehmer** oder **Priorität im Gruppen-Audio**  
- **Konvoi-Modus:** gemeinsames **Ziel / Abfahrtfenster** in der Gruppe; **Status** (Pause, Tanken, Grenze) per **Schnellaktion** + optional Sprachhook  
- **Sprachqualität & UX:** sprechende Indikatoren, **Rauschunterdrückung** (Client-seitig wo möglich), **kurze Haptik** bei PTT-Start/Ende  

### Information & Orientierung

- **Strukturierte Weg-/Grenz-Meldungen** (Wartezeit, Spur, Stau) mit **Kartenbezug** und einfacher **Auswertung** („Trend letzte 2 h“)  
- **Mehrsprachige Oberfläche** (DE/TR/EN+) und später **Untertitel** für Sprachnachrichten (Zugänglichkeit, laute Umgebung)  
- **Offizielle / kuratierte Infos** (Behörden, Partner) klar von **User-Live** getrennt, aber **verlinkt** (ein Tap zur Quelle)  

### Reichweite & Sicherheit

- Push (FCM/APNs): **Hilfe**, **Posts in der Nähe**, **Gruppen-Pings** („Wir starten in 30 Min“)  
- Medien & Objektspeicher (MinIO) für **Fotos** (z. B. Schild an Grenze – mit Moderation)  
- OSRM/Valhalla optional self-hosted; **Navigation** in der App weiter vertiefen (Abweichung, TTS – teils vorhanden)  
- **Moderation**, Meldungen, Sperren – besonders bei **Kartenpräsenz** und **Sprache**  

Siehe auch [STACK.md](./STACK.md) und [PANIC_HELP_SPEC.md](./PANIC_HELP_SPEC.md).
