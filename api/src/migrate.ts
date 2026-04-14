import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './pool.js'

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
  await ensureMapIconColumn()
  await ensureTollVehicleClassColumn()
}

export async function runMigrations(): Promise<void> {
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8')
  await pool.query(sql)
  await ensureVoiceMessageColumns()
  await ensureMapIconColumn()
  await ensureTollVehicleClassColumn()
  await ensureKnowledgeBaseTables()
  await ensureRoadAndConvoyExtensions()
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
}
