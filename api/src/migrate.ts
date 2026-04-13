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

export async function runMigrations(): Promise<void> {
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8')
  await pool.query(sql)
  await ensureVoiceMessageColumns()
  await ensureMapIconColumn()
  await ensureRoadAndConvoyExtensions()

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
