import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './pool.js'
import { seedCommunityDemoPostsIfEmpty } from './seedCommunityDemo.js'
import { seedTurkeyRouteCsvCuratedPlaces } from './seedTurkeyRouteCsvPois.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Bestehende DBs: Spalten für Sprachnachrichten ergänzen (idempotent). */
async function ensureMapIconColumn(): Promise<void> {
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS map_icon TEXT NOT NULL DEFAULT 'person'`)
  await pool.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_map_icon_check`)
  await pool.query(`
    ALTER TABLE users ADD CONSTRAINT users_map_icon_check CHECK (
      map_icon IN (
        'person','directions_car','local_shipping','airport_shuttle','two_wheeler','rv_hookup',
        'train','sailing','pedal_bike','hiking','family_restroom','pets','badge','flag','local_taxi','warehouse'
      )
    )
  `)
}

async function ensureRoadAndConvoyExtensions(): Promise<void> {
  await pool.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS convoy_destination TEXT`)
  await pool.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS convoy_departure_note TEXT`)
  await pool.query(`ALTER TABLE groups ADD COLUMN IF NOT EXISTS convoy_status TEXT`)
  await pool.query(`ALTER TABLE groups DROP CONSTRAINT IF EXISTS groups_convoy_status_check`)
  await pool.query(`
    ALTER TABLE groups ADD CONSTRAINT groups_convoy_status_check CHECK (
      convoy_status IS NULL OR convoy_status IN ('driving', 'pause', 'fuel', 'border', 'arrived')
    )
  `)

  await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS border_wait_minutes INTEGER`)
  await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS border_slug TEXT`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS post_reports (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      post_id UUID NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
      reporter_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      reason TEXT NOT NULL CHECK (char_length(reason) >= 1 AND char_length(reason) <= 500),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (post_id, reporter_id)
    )
  `)
}

async function ensureTollVehicleClassColumn(): Promise<void> {
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS toll_vehicle_class TEXT NOT NULL DEFAULT 'car'`)
  await pool.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_toll_vehicle_class_check`)
  await pool.query(`
    ALTER TABLE users ADD CONSTRAINT users_toll_vehicle_class_check CHECK (
      toll_vehicle_class IN ('car', 'motorcycle', 'heavy', 'other')
    )
  `)
}

async function ensureUserAiColumns(): Promise<void> {
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_model TEXT`)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_base_url TEXT`)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_api_key_encrypted TEXT`)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_system_prompt TEXT`)
  await pool.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS ai_include_full_context BOOLEAN NOT NULL DEFAULT false`,
  )
}

/** Zentrale KI-Konfiguration (OpenAI-kompatibel) für alle Nutzer – nur per Admin-UI. */
async function ensureAdminAiSettingsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_ai_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      openai_api_key_encrypted TEXT,
      ai_model TEXT,
      ai_base_url TEXT,
      default_extra_system_prompt TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await pool.query(`INSERT INTO admin_ai_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`)
}

async function ensureUserRoleColumn(): Promise<void> {
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'`)
  await pool.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`)
  await pool.query(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin'))`)
  await pool.query(`UPDATE users SET role = 'admin' WHERE email = 'test@yol.local'`)
}

/** Karten-POIs und Live-Präsenz: bei älteren DBs ohne einmaliges INIT_DB anlegen (verhindert 500 auf /api/pois, /api/presence/nearby). */
async function ensureMapPoisAndLivePresenceTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS map_pois (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      created_by UUID REFERENCES users (id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'other',
      lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL,
      note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS map_pois_created_idx ON map_pois (created_at DESC)`,
  )
  await pool.query(`
    CREATE TABLE IF NOT EXISTS map_live_positions (
      user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
      lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS map_live_positions_updated_idx ON map_live_positions (updated_at DESC)`,
  )
}

async function ensureCuratedPlacesTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS curated_places (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      category TEXT NOT NULL CHECK (category IN ('accommodation', 'restaurant', 'rest_area', 'workshop', 'border')),
      name TEXT NOT NULL CHECK (char_length(name) >= 1 AND char_length(name) <= 200),
      description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 4000),
      lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL,
      address TEXT NOT NULL DEFAULT '' CHECK (char_length(address) <= 400),
      region TEXT NOT NULL DEFAULT '' CHECK (char_length(region) <= 160),
      phone TEXT NOT NULL DEFAULT '' CHECK (char_length(phone) <= 80),
      website TEXT NOT NULL DEFAULT '' CHECK (char_length(website) <= 500),
      image_url TEXT NOT NULL DEFAULT '' CHECK (char_length(image_url) <= 800),
      is_published BOOLEAN NOT NULL DEFAULT true,
      sort_order INTEGER NOT NULL DEFAULT 0,
      route_code TEXT CHECK (
        route_code IS NULL OR route_code IN ('A_NORTH', 'B_WEST', 'C_SOUTH', 'COMMON')
      ),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS curated_places_category_idx ON curated_places (category)`,
  )
  await pool.query(
    `CREATE INDEX IF NOT EXISTS curated_places_published_sort_idx ON curated_places (is_published, sort_order DESC, created_at DESC)`,
  )
  /** route_code-Index erst in ensureCuratedPlacesSilaColumns (Spalte fehlt auf Alt-DBs). */
}

/** Bestehende DBs: Kategorien + route_code nachziehen (idempotent). */
async function ensureCuratedPlacesSilaColumns(): Promise<void> {
  const t = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'curated_places'
     ) AS ok`,
  )
  if (!t.rows[0]?.ok) return

  await pool.query(`ALTER TABLE curated_places ADD COLUMN IF NOT EXISTS route_code TEXT`)
  await pool.query(`ALTER TABLE curated_places DROP CONSTRAINT IF EXISTS curated_places_route_code_check`)
  await pool.query(`
    ALTER TABLE curated_places ADD CONSTRAINT curated_places_route_code_check CHECK (
      route_code IS NULL OR route_code IN ('A_NORTH', 'B_WEST', 'C_SOUTH', 'COMMON')
    )
  `)
  await pool.query(`ALTER TABLE curated_places DROP CONSTRAINT IF EXISTS curated_places_category_check`)
  await pool.query(`
    ALTER TABLE curated_places ADD CONSTRAINT curated_places_category_check CHECK (
      category IN ('accommodation', 'restaurant', 'rest_area', 'workshop', 'border')
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS curated_places_route_code_idx ON curated_places (route_code) WHERE route_code IS NOT NULL`)
}

async function seedBerlinTurkeyRouteFaqExtras(): Promise<void> {
  const kb = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'kb_route_faq'
     ) AS ok`,
  )
  if (!kb.rows[0]?.ok) return
  await pool.query(
    `INSERT INTO kb_route_faq (id, corridor, question, answer, tags, source_url)
     VALUES
       ('berlin-tr-04', 'berlin_turkey', 'Welche Hauptrouten führen in die Türkei (Sıla)?',
        'Drei typische Varianten: Nord über CZ/SK/AT/HU, West über AT/HU ab Passau, Süd über AT/SI/HR (kürzer, aber mehr Grenzen). Ab Belgrad verlaufen alle über Serbien, Bulgarien und den Grenzübergang Kapıkule/Kapitan Andreevo nach Edirne und weiter nach Istanbul.',
        ARRAY['route','planning'], null),
       ('berlin-tr-05', 'berlin_turkey', 'Warum kann es an Kapıkule so lange dauern?',
        'Kapıkule (BG–TR) ist die meistbefahrene PKW-Lkw-Grenze – in Hochsaison sind mehrstündige Wartezeiten möglich. Tipp: Zeitpuffer einplanen, Verpflegung dabei haben, offizielle Wartebereiche nutzen und auf Betrüger an Parkplätzen achten.',
        ARRAY['border','kapikule','timing'], null),
       ('berlin-tr-06', 'berlin_turkey', 'Grenze Kroatien–Serbien (Batrovci) vs. Ungarn–Serbien (Horgoš)?',
        'Beide können je nach Saison und Tageszeit stark belastet sein. Batrovci (Route über HR) und Horgoš/Röszke (Route über HU) sind bekannte Engpässe – Alternativrouten sind oft länger; aktuelle Staus in Community oder Navigations-Apps prüfen.',
        ARRAY['border','routing'], null),
       ('berlin-tr-07', 'berlin_turkey', 'Wo tanken vor der teureren Strecke?',
        'Vor Einreise in die Türkei lohnt sich oft Tanken in Bulgarien oder Serbien (Preise beobachten). In der App kannst du kuratierte Tank-/Rastorte entlang der Route anzeigen lassen.',
        ARRAY['fuel','planning'], null)
     ON CONFLICT (id) DO UPDATE SET
       question = EXCLUDED.question,
       answer = EXCLUDED.answer,
       tags = EXCLUDED.tags,
       source_url = EXCLUDED.source_url,
       verified_at = now()`,
  )
}

async function ensureVignetteServiceTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vignette_service_products (
      id TEXT PRIMARY KEY,
      country_code TEXT NOT NULL CHECK (char_length(country_code) = 2),
      vehicle_class TEXT NOT NULL DEFAULT 'car' CHECK (vehicle_class IN ('car', 'motorcycle', 'heavy', 'other', 'all')),
      kind TEXT NOT NULL DEFAULT 'vignette' CHECK (kind IN ('vignette', 'toll', 'info')),
      title TEXT NOT NULL CHECK (char_length(title) >= 1 AND char_length(title) <= 200),
      description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
      official_url TEXT NOT NULL DEFAULT '' CHECK (char_length(official_url) <= 800),
      partner_checkout_url TEXT NOT NULL DEFAULT '' CHECK (char_length(partner_checkout_url) <= 800),
      retail_hint_eur NUMERIC(10, 2),
      service_fee_eur NUMERIC(10, 2) NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT true,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS vignette_service_products_country_idx ON vignette_service_products (country_code)`,
  )
  await pool.query(
    `CREATE INDEX IF NOT EXISTS vignette_service_products_active_idx ON vignette_service_products (is_active)`,
  )
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vignette_order_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'in_review', 'quoted', 'paid', 'fulfilled', 'cancelled')
      ),
      vehicle_class TEXT NOT NULL CHECK (vehicle_class IN ('car', 'motorcycle', 'heavy', 'other')),
      countries_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      route_label TEXT NOT NULL DEFAULT '' CHECK (char_length(route_label) <= 400),
      selected_product_ids TEXT[] NOT NULL DEFAULT '{}',
      customer_note TEXT NOT NULL DEFAULT '' CHECK (char_length(customer_note) <= 2000),
      admin_note TEXT NOT NULL DEFAULT '' CHECK (char_length(admin_note) <= 2000),
      quoted_total_eur NUMERIC(10, 2),
      stripe_checkout_session_id TEXT,
      paid_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS vignette_order_requests_created_idx ON vignette_order_requests (created_at DESC)`,
  )
  await pool.query(
    `CREATE INDEX IF NOT EXISTS vignette_order_requests_status_idx ON vignette_order_requests (status)`,
  )
}

async function ensureVignetteOrderPaymentColumns(): Promise<void> {
  const t = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'vignette_order_requests'
     ) AS ok`,
  )
  if (!t.rows[0]?.ok) return
  await pool.query(
    `ALTER TABLE vignette_order_requests ADD COLUMN IF NOT EXISTS stripe_checkout_session_id TEXT`,
  )
  await pool.query(`ALTER TABLE vignette_order_requests ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`)
  await pool.query(`ALTER TABLE vignette_order_requests ADD COLUMN IF NOT EXISTS paypal_order_id TEXT`)
}

async function seedVignetteServiceProductsIfEmpty(): Promise<void> {
  const c = await pool.query(`SELECT COUNT(*)::int AS n FROM vignette_service_products`)
  if ((c.rows[0]?.n ?? 0) > 0) return
  await pool.query(
    `INSERT INTO vignette_service_products (id, country_code, vehicle_class, kind, title, description, official_url, partner_checkout_url, retail_hint_eur, service_fee_eur, sort_order)
     VALUES
       ('svc-at-car', 'AT', 'car', 'vignette', 'Österreich – Digitale Vignette (Pkw)',
        'Hinweis: Endpreis zzgl. Servicepauschale; finale Abwicklung durch Team.', 'https://www.asfinag.at/en/toll/vignette/', '', NULL, 4.99, 20),
       ('svc-hu-car', 'HU', 'car', 'vignette', 'Ungarn – e-Matrica',
        'Digitale Vignette; Fahrzeugklasse beim Kauf beachten.', 'https://nemzetiutdij.hu/', '', NULL, 4.99, 18),
       ('svc-bg-car', 'BG', 'car', 'vignette', 'Bulgarien – E-Vignette',
        'Vor Nutzung mautpflichtiger Strecken aktivieren.', 'https://web.bgtoll.bg/', '', NULL, 4.99, 15),
       ('svc-si-car', 'SI', 'car', 'vignette', 'Slowenien – Vignette',
        'Digitale Vignette für Pkw.', 'https://evinjeta.dars.si/', '', NULL, 4.99, 12),
       ('svc-sk-car', 'SK', 'car', 'vignette', 'Slowakei – elektronische Vignette',
        'E-Vignette nach Kategorie.', 'https://eznamka.sk/', '', NULL, 4.99, 12),
       ('svc-cz-car', 'CZ', 'car', 'vignette', 'Tschechien – elektronische Vignette',
        'E-Vignette.', 'https://edalnice.cz/', '', NULL, 4.99, 12),
       ('svc-ch-car', 'CH', 'car', 'vignette', 'Schweiz – Autobahnvignette',
        'Physische oder digitale Vignette je nach Angebot prüfen.', 'https://www.ch.ch/de/strassenverkehr/autobahn-und-verkehrsvignette/', '', NULL, 6.99, 10)
     ON CONFLICT (id) DO NOTHING`,
  )
}

async function seedCuratedPlacesIfEmpty(): Promise<void> {
  const c = await pool.query(`SELECT COUNT(*)::int AS n FROM curated_places`)
  if ((c.rows[0]?.n ?? 0) > 0) return
  await pool.query(
    `INSERT INTO curated_places (id, category, name, description, lat, lng, address, region, phone, website, image_url, is_published, sort_order)
     VALUES
       ('a0000001-0001-4000-8000-000000000001', 'accommodation', 'Beispiel Unterkunft (Berlin)',
        'Redaktioneller Tipp – ersetzen oder löschen im Admin-Panel.', 52.5208, 13.4094,
        'Musterstraße 1', 'Berlin', '', '', '', true, 10),
       ('a0000001-0001-4000-8000-000000000002', 'restaurant', 'Beispiel Restaurant an der Strecke',
        'Redaktioneller Tipp für Reisende Richtung Süden.', 52.4986, 13.4033,
        'Nahe A100', 'Berlin', '', '', '', true, 5),
       ('a0000001-0001-4000-8000-000000000003', 'rest_area', 'Beispiel Rasthof / Pause',
        'Tanken, Toilette, kurze Pause – Inhalt im Admin-Panel anpassen.', 52.4514, 13.5112,
        'Autobahn-Umfeld', 'Berlin Süd', '', '', '', true, 0)
     ON CONFLICT (id) DO NOTHING`,
  )
}

/**
 * Strategische Stops Sıla-Route (Europa → Istanbul): idempotent per fester UUID.
 * Läuft auch wenn bereits Berlin-Demo-POIs existieren.
 */
async function seedSilaStrategicCuratedPlaces(): Promise<void> {
  const t = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'curated_places'
     ) AS ok`,
  )
  if (!t.rows[0]?.ok) return
  const col = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'curated_places' AND column_name = 'route_code'`,
  )
  if ((col.rows[0]?.c ?? 0) < 1) return

  await pool.query(
    `INSERT INTO curated_places (
       id, category, name, description, lat, lng, address, region, phone, website, image_url,
       is_published, sort_order, route_code
     )
     VALUES
       ('c2a10000-0001-4000-8000-000000000001', 'rest_area', 'Dresden Autohof (A4, Richtung CZ)',
        'Typischer Stopp Route Nord vor Tschechien: tanken, kurze Pause, oft 24/7-Bereiche in der Nähe der A4.', 51.0504, 13.7373,
        'A4 Umfeld', 'Deutschland', '', '', '', true, 88, 'A_NORTH'),
       ('c2a10000-0001-4000-8000-000000000002', 'rest_area', 'Würzburg Autohof (A3)',
        'Beliebter Pausepunkt Route West Richtung Nürnberg/Passau; vor AT ggf. tanken (Preise vergleichen).', 49.7913, 9.9534,
        'A3', 'Deutschland', '', '', '', true, 87, 'B_WEST'),
       ('c2a10000-0001-4000-8000-000000000003', 'rest_area', 'Rosenheim Autohof (A8)',
        'Klassischer Stopp Route Süd kurz vor Grenze Walserberg / Österreich.', 47.8516, 12.1289,
        'A8', 'Deutschland', '', '', '', true, 86, 'C_SOUTH'),
       ('c2a10000-0001-4000-8000-000000000004', 'restaurant', 'Wien – Übernachtung / türkische Gastronomie',
        'Großer Stopp: z. B. Favoriten (10. Bez.) oder Brunnenmarkt Ottakring – viele türkische Lokale; Autobahn Umfahrung A23/S1 beachten.', 48.2082, 16.3738,
        'Stadtgebiet', 'Österreich', '', '', '', true, 85, 'COMMON'),
       ('c2a10000-0001-4000-8000-000000000005', 'accommodation', 'Budapest – Übernachtung vor dem Balkan',
        'Letzter EU-Großstadt-Stopp mit gutem Preis-Leistungs-Verhältnis; M0-Ring / MOL-Tankstellen für Route planen.', 47.4979, 19.0402,
        'Zentrum / Ring', 'Ungarn', '', '', '', true, 84, 'COMMON'),
       ('c2a10000-0001-4000-8000-000000000006', 'rest_area', 'Szeged – letzter HU-Stopp vor RS',
        'Oft günstiger tanken als weiter südlich; Grenze Röszke/Horgoš kann in Hochsaison stark sein – Zeitpuffer.', 46.253, 20.1414,
        'M5 Umfeld', 'Ungarn', '', '', '', true, 83, 'COMMON'),
       ('c2a10000-0001-4000-8000-000000000007', 'accommodation', 'Zagreb – Übernachtung (nur Route Süd)',
        'Empfohlener Etappenstopp auf der kürzeren Variante über HR; Maut Kroatien einplanen.', 45.815, 15.9819,
        'Stadt', 'Kroatien', '', '', '', true, 82, 'C_SOUTH'),
       ('c2a10000-0001-4000-8000-000000000008', 'rest_area', 'Belgrad – Korridor-X-Treffpunkt',
        'Etwa Streckenmitte: alle drei Varianten laufen hier zusammen; Maut Serbien an Zapfstellen bezahlen.', 44.8176, 20.4569,
        'Autobahn-Umfahrung A1/A4', 'Serbien', '', '', '', true, 81, 'COMMON'),
       ('c2a10000-0001-4000-8000-000000000009', 'restaurant', 'Niš – Stopp vor Bulgarien',
        'Historische Stadt, gute Übernachtungs- und Essensoptionen; klassischer Wegpunkt vor Grenze RS–BG.', 43.3209, 21.8958,
        'Zentrum / E80', 'Serbien', '', '', '', true, 80, 'COMMON'),
       ('c2a10000-0001-4000-8000-000000000010', 'workshop', 'Sofia – Werkstätten (Ausfall Richtung TR)',
        'Entlang Tsarigradsko Shose u. a. Mehrmarken- und Vertragswerkstätten; bei Panne vorab telefonisch klären.', 42.6977, 23.3219,
        'Ost / Ring', 'Bulgarien', '', '', '', true, 79, 'COMMON'),
       ('c2a10000-0001-4000-8000-000000000011', 'rest_area', 'Svilengrad – letzter BG-Stopp vor TR',
        'Kurz vor der Grenze: Hotels für Wartezeiten bekannt; Tanken oft noch günstiger als in TR.', 41.7693, 26.2073,
        'A4 / Grenznähe', 'Bulgarien', '', '', '', true, 78, 'COMMON'),
       ('c2a10000-0001-4000-8000-000000000012', 'border', 'Kapıkule / Kapitan Andreevo (BG–TR)',
        'Hauptgrenze: in Hochsaison sehr lange Wartezeiten möglich – Verpflegung, Zeitpuffer, nur offizielle Bereiche.', 41.7167, 26.3333,
        'Grenzübergang', 'BG / TR', '', '', '', true, 77, 'COMMON'),
       ('c2a10000-0001-4000-8000-000000000013', 'restaurant', 'Edirne – Köfte & erste TR-Versorgung',
        'Erster größerer TR-Stopp nach der Grenze: Selimiye, Köfte-Lokale; HGS/OGS für Maut nicht vergessen.', 41.6771, 26.5557,
        'Zentrum', 'Türkiye', '', '', '', true, 76, 'COMMON')
     ON CONFLICT (id) DO UPDATE SET
       category = EXCLUDED.category,
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       lat = EXCLUDED.lat,
       lng = EXCLUDED.lng,
       address = EXCLUDED.address,
       region = EXCLUDED.region,
       phone = EXCLUDED.phone,
       website = EXCLUDED.website,
       image_url = EXCLUDED.image_url,
       is_published = EXCLUDED.is_published,
       sort_order = EXCLUDED.sort_order,
       route_code = EXCLUDED.route_code,
       updated_at = now()`,
  )
}

async function ensureRideShareMarketplaceTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ride_listings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      offer_kind TEXT NOT NULL CHECK (offer_kind IN ('passenger', 'cargo', 'both')),
      route_from TEXT NOT NULL CHECK (char_length(route_from) >= 1 AND char_length(route_from) <= 200),
      route_to TEXT NOT NULL CHECK (char_length(route_to) >= 1 AND char_length(route_to) <= 200),
      departure_note TEXT NOT NULL DEFAULT '' CHECK (char_length(departure_note) <= 500),
      free_seats SMALLINT CHECK (free_seats IS NULL OR (free_seats >= 0 AND free_seats <= 12)),
      cargo_space_note TEXT NOT NULL DEFAULT '' CHECK (char_length(cargo_space_note) <= 500),
      details TEXT NOT NULL CHECK (char_length(details) >= 1 AND char_length(details) <= 2000),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ride_listings_created_idx ON ride_listings (created_at DESC)`,
  )
  await pool.query(`CREATE INDEX IF NOT EXISTS ride_listings_status_idx ON ride_listings (status)`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ride_requests (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      listing_id UUID NOT NULL REFERENCES ride_listings (id) ON DELETE CASCADE,
      requester_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      request_kind TEXT NOT NULL CHECK (request_kind IN ('passenger', 'cargo')),
      message TEXT NOT NULL DEFAULT '' CHECK (char_length(message) <= 800),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'withdrawn', 'accepted', 'declined')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS ride_requests_listing_idx ON ride_requests (listing_id, created_at DESC)`,
  )
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ride_requests_one_pending_per_user
      ON ride_requests (listing_id, requester_id)
      WHERE status = 'pending'
  `)
}

async function ensureAssistantMemoryTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS assistant_memory (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      group_id UUID NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      question TEXT NOT NULL CHECK (char_length(question) >= 1 AND char_length(question) <= 2000),
      answer TEXT NOT NULL CHECK (char_length(answer) >= 1 AND char_length(answer) <= 8000),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS assistant_memory_group_created_idx ON assistant_memory (group_id, created_at DESC)`,
  )
}

async function ensurePostMediaColumns(): Promise<void> {
  await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS media_kind TEXT`)
  await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS media_storage_key TEXT`)
  await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS media_mime TEXT`)
  await pool.query(`ALTER TABLE posts ALTER COLUMN body SET DEFAULT ''`)
  await pool.query(`ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_need_content`)
  await pool.query(`
    ALTER TABLE posts ADD CONSTRAINT posts_need_content CHECK (
      char_length(trim(body)) >= 1 OR (media_storage_key IS NOT NULL AND char_length(trim(media_storage_key)) >= 1)
    )
  `)
}

/** Vollbild-/Overlay-Werbung: Zeitfenster, Mehrsprache, Klick- & Impressionszähler. */
async function ensurePromotionCampaignsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS promotion_campaigns (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      internal_name TEXT NOT NULL CHECK (char_length(internal_name) >= 1 AND char_length(internal_name) <= 160),
      headline_de TEXT NOT NULL DEFAULT '' CHECK (char_length(headline_de) <= 240),
      headline_tr TEXT NOT NULL DEFAULT '' CHECK (char_length(headline_tr) <= 240),
      headline_en TEXT NOT NULL DEFAULT '' CHECK (char_length(headline_en) <= 240),
      body_de TEXT NOT NULL DEFAULT '' CHECK (char_length(body_de) <= 1200),
      body_tr TEXT NOT NULL DEFAULT '' CHECK (char_length(body_tr) <= 1200),
      body_en TEXT NOT NULL DEFAULT '' CHECK (char_length(body_en) <= 1200),
      image_url TEXT NOT NULL DEFAULT '' CHECK (char_length(image_url) <= 800),
      cta_label_de TEXT NOT NULL DEFAULT '' CHECK (char_length(cta_label_de) <= 160),
      cta_label_tr TEXT NOT NULL DEFAULT '' CHECK (char_length(cta_label_tr) <= 160),
      cta_label_en TEXT NOT NULL DEFAULT '' CHECK (char_length(cta_label_en) <= 160),
      cta_url TEXT NOT NULL CHECK (char_length(cta_url) >= 8 AND char_length(cta_url) <= 800),
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      priority INTEGER NOT NULL DEFAULT 0,
      impression_count BIGINT NOT NULL DEFAULT 0,
      click_count BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT promotion_campaigns_time_check CHECK (ends_at > starts_at)
    )
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS promotion_campaigns_window_idx ON promotion_campaigns (is_active, starts_at, ends_at, priority DESC)`,
  )
  await ensurePromotionShowIntervalColumn()
}

/** Bestehende DBs: Mindestabstand bis zur erneuten Anzeige nach Schließen (Minuten). */
async function ensurePromotionShowIntervalColumn(): Promise<void> {
  const t = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'promotion_campaigns'
     ) AS ok`,
  )
  if (!t.rows[0]?.ok) return
  await pool.query(
    `ALTER TABLE promotion_campaigns ADD COLUMN IF NOT EXISTS show_again_after_minutes INTEGER NOT NULL DEFAULT 60`,
  )
  await pool.query(
    `UPDATE promotion_campaigns SET show_again_after_minutes = 60 WHERE show_again_after_minutes IS NULL`,
  )
}

async function ensureRadioChannelsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS radio_channels (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL CHECK (char_length(name) >= 1 AND char_length(name) <= 200),
      stream_url TEXT NOT NULL CHECK (char_length(stream_url) >= 8 AND char_length(stream_url) <= 2000),
      sort_order INTEGER NOT NULL DEFAULT 0,
      enabled BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS radio_channels_enabled_sort_idx ON radio_channels (enabled, sort_order DESC, name ASC)`,
  )
}

async function ensureKnowledgeBaseTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kb_country_facts (
      country_code TEXT NOT NULL CHECK (char_length(country_code) = 2),
      fact_key TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      source_url TEXT,
      verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (country_code, fact_key)
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kb_toll_offers (
      id TEXT PRIMARY KEY,
      country_code TEXT NOT NULL CHECK (char_length(country_code) = 2),
      vehicle_class TEXT NOT NULL CHECK (vehicle_class IN ('car', 'motorcycle', 'heavy', 'other')),
      kind TEXT NOT NULL CHECK (kind IN ('vignette', 'toll', 'info')),
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      purchase_url TEXT NOT NULL,
      source_url TEXT,
      verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await pool.query(
    `CREATE INDEX IF NOT EXISTS kb_toll_offers_country_vehicle_idx ON kb_toll_offers (country_code, vehicle_class)`,
  )
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kb_route_faq (
      id TEXT PRIMARY KEY,
      corridor TEXT NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      tags TEXT[] NOT NULL DEFAULT '{}'::text[],
      source_url TEXT,
      verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
}

async function seedBerlinTurkeyKnowledgeBase(): Promise<void> {
  await pool.query(
    `INSERT INTO kb_country_facts (country_code, fact_key, title, content, source_url)
     VALUES
       ('AT', 'at-vignette', 'Österreich', 'Autobahn/Schnellstraße: digitale Vignette bzw. Streckenmaut prüfen.', 'https://www.asfinag.at/en/toll/vignette/'),
       ('HU', 'hu-ematrica', 'Ungarn', 'E-Matrica vor Auffahrt prüfen; Kennzeichen und Kategorie korrekt eingeben.', 'https://nemzetiutdij.hu/'),
       ('RS', 'rs-toll', 'Serbien', 'Auf Hauptkorridoren meist streckenbezogene Mautstationen statt klassischer Jahresvignette.', 'https://www.putevi-srbije.rs/'),
       ('BG', 'bg-vignette', 'Bulgarien', 'E-Vignette für viele Straßen erforderlich; Fahrzeugklasse korrekt wählen.', 'https://web.bgtoll.bg/'),
       ('TR', 'tr-hgs', 'Türkiye', 'Maut auf Brücken/Autobahnen über HGS/OGS oder offizielle Zahlungswege.', 'https://www.kgm.gov.tr/')
     ON CONFLICT (country_code, fact_key) DO UPDATE SET
       title = EXCLUDED.title,
       content = EXCLUDED.content,
       source_url = EXCLUDED.source_url,
       verified_at = now()`,
  )

  await pool.query(
    `INSERT INTO kb_toll_offers (id, country_code, vehicle_class, kind, title, description, purchase_url, source_url)
     VALUES
       ('at-car', 'AT', 'car', 'vignette', 'AT Digitale Vignette', 'Pkw/Kleinbus: vor Autobahnfahrt digitale Vignette prüfen.', 'https://www.asfinag.at/en/toll/vignette/', 'https://www.asfinag.at/en/toll/vignette/'),
       ('at-mc', 'AT', 'motorcycle', 'vignette', 'AT Motorrad-Vignette', 'Motorrad: Kategorie korrekt wählen, Kennzeichen prüfen.', 'https://www.asfinag.at/en/toll/vignette/', 'https://www.asfinag.at/en/toll/vignette/'),
       ('hu-all', 'HU', 'car', 'vignette', 'HU e-Matrica', 'Ungarn e-Matrica für Pkw.', 'https://nemzetiutdij.hu/', 'https://nemzetiutdij.hu/'),
       ('hu-mc', 'HU', 'motorcycle', 'vignette', 'HU e-Matrica Motorrad', 'Ungarn e-Matrica für Motorrad.', 'https://nemzetiutdij.hu/', 'https://nemzetiutdij.hu/'),
       ('bg-all', 'BG', 'car', 'vignette', 'BG e-Vignette', 'Bulgarien e-Vignette für Pkw.', 'https://web.bgtoll.bg/', 'https://web.bgtoll.bg/'),
       ('tr-hgs-all', 'TR', 'car', 'toll', 'TR HGS', 'Türkiye Mautzahlung über HGS/OGS.', 'https://www.kgm.gov.tr/', 'https://www.kgm.gov.tr/')
     ON CONFLICT (id) DO UPDATE SET
       title = EXCLUDED.title,
       description = EXCLUDED.description,
       purchase_url = EXCLUDED.purchase_url,
       source_url = EXCLUDED.source_url,
       verified_at = now()`,
  )

  await pool.query(
    `INSERT INTO kb_route_faq (id, corridor, question, answer, tags, source_url)
     VALUES
       ('berlin-tr-01', 'berlin_turkey', 'Welche Unterlagen sollte ich immer dabeihaben?', 'Reisepass/Ausweis, Fahrzeugschein, Führerschein, Versicherung/Grüne Karte, ggf. Vollmacht bei fremdem Fahrzeug.', ARRAY['documents','border'], 'https://europa.eu/youreurope/citizens/travel/index_de.htm'),
       ('berlin-tr-02', 'berlin_turkey', 'Wann ist an Grenzen am meisten los?', 'Typisch: Ferienbeginn/ende, Wochenenden, Feiertage und Abendspitzen. Wenn möglich früh morgens oder nachts queren.', ARRAY['border','timing'], null),
       ('berlin-tr-03', 'berlin_turkey', 'Soll ich Vignette vorher kaufen?', 'Ja, am besten vor der Einfahrt in mautpflichtige Strecken digital kaufen und Kennzeichen doppelt prüfen.', ARRAY['vignette','payment'], null)
     ON CONFLICT (id) DO UPDATE SET
       question = EXCLUDED.question,
       answer = EXCLUDED.answer,
       tags = EXCLUDED.tags,
       source_url = EXCLUDED.source_url,
       verified_at = now()`,
  )
  await seedBerlinTurkeyRouteFaqExtras()
}

async function ensureVoiceMessageColumns(): Promise<void> {
  await pool.query(`ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text'`)
  await pool.query(`ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS voice_mime TEXT`)
  await pool.query(`ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS voice_duration_ms INTEGER`)
  await pool.query(`ALTER TABLE group_messages ADD COLUMN IF NOT EXISTS voice_storage_key TEXT`)
  await pool.query(`ALTER TABLE group_messages ALTER COLUMN body SET DEFAULT ''`)
  await pool.query(`ALTER TABLE group_messages DROP CONSTRAINT IF EXISTS group_messages_body_check`)
  await pool.query(`ALTER TABLE group_messages DROP CONSTRAINT IF EXISTS group_messages_body_rules`)
  await pool.query(`ALTER TABLE group_messages DROP CONSTRAINT IF EXISTS group_messages_body_check_v2`)
  await pool.query(`
    ALTER TABLE group_messages ADD CONSTRAINT group_messages_body_rules CHECK (
      char_length(body) <= 4000 AND (
        (message_type = 'text' AND char_length(body) >= 1) OR message_type = 'voice'
      )
    )
  `)

  await pool.query(`ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text'`)
  await pool.query(`ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS voice_mime TEXT`)
  await pool.query(`ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS voice_duration_ms INTEGER`)
  await pool.query(`ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS voice_storage_key TEXT`)
  await pool.query(`ALTER TABLE post_comments ALTER COLUMN body SET DEFAULT ''`)
  await pool.query(`ALTER TABLE post_comments DROP CONSTRAINT IF EXISTS post_comments_body_check`)
  await pool.query(`ALTER TABLE post_comments DROP CONSTRAINT IF EXISTS post_comments_body_rules`)
  await pool.query(`ALTER TABLE post_comments DROP CONSTRAINT IF EXISTS post_comments_body_check_v2`)
  await pool.query(`
    ALTER TABLE post_comments ADD CONSTRAINT post_comments_body_rules CHECK (
      char_length(body) <= 2000 AND (
        (message_type = 'text' AND char_length(body) >= 1) OR message_type = 'voice'
      )
    )
  `)
}

/**
 * Läuft bei jedem API-Start (ohne INIT_DB): fehlende Nutzer-Spalten nachziehen.
 * Verhindert 500er bei /auth/login und /auth/register auf älteren Datenbanken.
 * Ohne Tabelle `users` (frische DB, INIT_DB noch nie): no-op.
 */
export async function ensureAuthSchemaPatches(): Promise<void> {
  const t = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'users'
     ) AS ok`,
  )
  if (!t.rows[0]?.ok) return
  await ensureUserAiColumns()
  await ensureAdminAiSettingsTable()
  await ensureMapIconColumn()
  await ensureTollVehicleClassColumn()
  await ensureMapPoisAndLivePresenceTables()
  const g = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'groups'
     ) AS ok`,
  )
  if (g.rows[0]?.ok) await ensureAssistantMemoryTable()
  await ensureRideShareMarketplaceTables()
  await ensureUserRoleColumn()
  await ensureCuratedPlacesTable()
  await ensureCuratedPlacesSilaColumns()
  await seedCuratedPlacesIfEmpty()
  await seedSilaStrategicCuratedPlaces()
  await seedTurkeyRouteCsvCuratedPlaces()
  await ensureVignetteServiceTables()
  await ensureVignetteOrderPaymentColumns()
  await seedVignetteServiceProductsIfEmpty()
  await ensureRadioChannelsTable()
  await ensurePostMediaColumns()
  await ensurePromotionCampaignsTable()
  await seedBerlinTurkeyRouteFaqExtras()
}

export async function runMigrations(): Promise<void> {
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8')
  await pool.query(sql)
  await ensureUserAiColumns()
  await ensureAdminAiSettingsTable()
  await ensureVoiceMessageColumns()
  await ensureMapIconColumn()
  await ensureTollVehicleClassColumn()
  await ensureKnowledgeBaseTables()
  await ensureRoadAndConvoyExtensions()
  await ensureAssistantMemoryTable()
  await ensureRideShareMarketplaceTables()
  await ensureUserRoleColumn()
  await ensureCuratedPlacesTable()
  await ensureCuratedPlacesSilaColumns()
  await seedCuratedPlacesIfEmpty()
  await seedSilaStrategicCuratedPlaces()
  await seedTurkeyRouteCsvCuratedPlaces()
  await ensureVignetteServiceTables()
  await ensureVignetteOrderPaymentColumns()
  await seedVignetteServiceProductsIfEmpty()
  await ensureRadioChannelsTable()
  await ensurePostMediaColumns()
  await ensurePromotionCampaignsTable()
  await seedBerlinTurkeyKnowledgeBase()

  await pool.query(
    `INSERT INTO borders (slug, title, country_a, country_b, wait_minutes, active_users_reporting, hero_image_url, rules_json)
     VALUES (
       'horgos',
       'Horgos - Röszke Sınır Kapısı',
       'SRB',
       'HU',
       45,
       12,
       'https://lh3.googleusercontent.com/aida-public/AB6AXuD9QvDxYzKnROlxgZ-q3lCbr4aTPzSBfwVQlnxM5cFKGinNxw7izcLvZ8uWlWaVjBYBAUya0JknmzOndU9Fd0mOOPm9W2e8AHHmW1iZi3oZ3sHiI-yM3LaKQxfX0XrrdkKkUGDyxISX048CJhKomQzBGsKK2kmFgie-2SFPX3bIibFYkFAKH8Pdl8h6ufD0A9L_vS_zIUAPVIvUfpmea7xqOsjDvIZ2PswngXrXKbQKnIH_kV0cRBUzHULkYVWs31fwew2sf1jBEV9d',
       $1::jsonb
     )
     ON CONFLICT (slug) DO NOTHING`,
    [
      JSON.stringify([
        { key: 'serbia_speed', title: 'Serbia Speed Limits', items: [{ label: 'Şehir İçi', value: '50 km/h' }, { label: 'Otoban', value: '130 km/h' }] },
        { key: 'hungary_vignette', title: 'Hungary Vignette', text: 'Pflicht auf Autobahnen. Digital erhältlich.' },
        { key: 'currency', title: 'Currency', text: 'RSD / EUR / HUF – Karte oft akzeptiert.' },
        { key: 'documents', title: 'Documents', text: 'Reisepass, Grüne Karte, Fahrzeugschein.' },
      ]),
    ],
  )

  /** Nur Entwicklung: fester Login (Passwort bcrypt, 10 Runden). In Produktion Nutzer löschen oder E-Mail ändern. */
  await pool.query(
    `INSERT INTO users (email, password_hash, display_name)
     VALUES (
       'test@yol.local',
       '$2a$10$HbvEUW06iBZ4Xz.2XllYCuIlNmxEm3b1pg3cTQhyUoJHBlt2noxW6',
       'Test User'
     )
     ON CONFLICT (email) DO NOTHING`,
  )

  await seedCommunityDemoPostsIfEmpty()
}
