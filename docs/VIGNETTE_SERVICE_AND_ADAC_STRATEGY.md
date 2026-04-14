# Vignetten- & Maut-Service: Produktstrategie und Marktbezug

Dieses Dokument beschreibt die **eigene Lösung** in dieser Anwendung (Katalog, Kaufanfrage, Admin) und ordnet sie **strategisch** ein. Es ist **kein** Nachbau oder Crawl fremder Webinhalte; urheberrechtlich geschützte Texte Dritter werden nicht übernommen.

## Referenz: ADAC Maut-Hub (nur zur Einordnung)

Der ADAC bündelt unter [Maut & Vignette](https://www.adac.de/reise-freizeit/maut-vignette/) Informationen zu vielen europäischen Ländern und verweist auf eigene Kanäle (z. B. Mautportal, Geschäftsstellen, Shop). Typische Marktlogik dort:

- Unterscheidung **streckenbezogene Maut** vs. **pauschale Vignette** vs. Sonderfälle (Tunnel, City-Maut).
- **Digitale** Produkte und **physische** Klebevignetten parallel.
- **Zusatzangebote** (z. B. Mautboxen) für wiederkehrende Nutzer.

**Konsequenz für uns:** Statt fremde Fließtexte zu spiegeln, eigene Kurztexte + verlinkte **offizielle** Behörden-/Betreiberseiten pflegen und den Mehrwert in **Bearbeitung, Beratung und gebündelten Kaufweg** legen.

## Unsere Implementierung (Ist)

- **Öffentlicher Katalog** (`vignette_service_products`): pro Land/Fahrzeugklasse Titel, Beschreibung, Links (offiziell + optional Partner-Checkout), Richtpreis-Hinweis, **Servicepauschale**, Sortierung, aktiv/inaktiv.
- **Nutzerflow:** Nach Routenplanung werden Länder aus der Maut-/Routenlogik genutzt; Nutzer wählen passende Produkte und senden eine **Anfrage** (`vignette_order_requests`) mit Route, Ländern, Fahrzeugklasse und Notiz.
- **Admin:** Produkte pflegen; Anfragen mit Status, Admin-Notiz und optionalem **Gesamtangebot** bearbeiten.

Damit ist Phase 1 ein **Concierge / Lead-to-Quote**-Modell: Ihr kontrolliert Preisgestaltung und Erfüllung und könnt **Servicepauschalen** zuverlässig erzielen.

## Strategische Weiterentwicklung (Soll)

1. **Zahlung & Erfüllung**
   - **Ist (Code):** Nach Admin-Status `quoted` und gesetztem `quoted_total_eur` kann der Kunde im **Profil** per **Stripe Checkout** zahlen (`STRIPE_SECRET_KEY`, `PUBLIC_WEB_APP_URL`). Bestätigung über Rückleitung + `confirm-checkout` (Session-Metadaten mit `userId` / `vignetteOrderId`).
   - **Weiter:** Positionen splitten („Behördengebühr“ vs. „Servicepauschale“), Webhooks, Deep-Link-Erfüllung bei Behörden/API-Partnern.

2. **Partner & Skalierung**
   - **Affiliate** oder White-Label mit etablierten Vignetten-Anbietern für Länder ohne eigene Integration.
   - **API-first** für Kernländer (AT, CH, HU, SI, …), wo digitale Vignetten programmierbar sind.

3. **Qualität & Haftung**
   - Immer **Disclaimer**: Routen-Länder ≠ garantiert benötigte Produkte; Nutzer prüft Pflicht gemäß Strecke und Fahrzeug.
   - Preise offizieller Stellen sind **dynamisch**; Richtpreis im Katalog nur als Hinweis, nicht als Zusage.

4. **Operations**
   - Checkliste „Länder entlang beliebter Routen“ mit fehlendem Katalogeintrag (Content-Lücken).
   - SLA für Rückmeldung auf Anfragen (z. B. 24–48 h), damit der Concierge-Ansatz vertrauenswürdig bleibt.

## Wettbewerbs- und Content-Leitplanken

- ADAC-Seiten und Länderunterseiten **nicht** automatisiert als Volltext übernehmen; stattdessen **eigene** Zusammenfassungen (1–3 Sätze) und **Primärquellen** (ASFINAG, BAG, HU-GO, …) verlinken.
- Marken und Angebote Dritter nur nennen, wenn rechtlich/vertraglich geklärt.

## Kurzfassung

Kurzfristig: **Anfrage + Admin-Angebot + Servicepauschale** – geringe technische und regulatorische Komplexität. Mittelfristig: **Zahlung und teilautomatische Erfüllung** dort, wo APIs existieren. Langfristig: **Mix aus Eigenintegration und Partnernetz** für flächendeckende Abdeckung ohne die Wartung kompletter Ländertexte von Drittanbietern.
