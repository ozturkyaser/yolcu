-- Yol Arkadaşım – Kernschema (PostgreSQL 16+)

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  map_icon TEXT NOT NULL DEFAULT 'person' CHECK (
    map_icon IN (
      'person',
      'directions_car',
      'local_shipping',
      'airport_shuttle',
      'two_wheeler',
      'rv_hookup',
      'train',
      'sailing',
      'pedal_bike',
      'hiking',
      'family_restroom',
      'pets',
      'badge',
      'flag',
      'local_taxi',
      'warehouse'
    )
  ),
  stats_km INTEGER NOT NULL DEFAULT 0,
  stats_regions INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  plate TEXT NOT NULL DEFAULT '',
  trailer_mode BOOLEAN NOT NULL DEFAULT false,
  is_primary BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('general', 'traffic', 'border', 'help')),
  location_label TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  expires_at TIMESTAMPTZ,
  helpful_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS posts_created_idx ON posts (created_at DESC);
CREATE INDEX IF NOT EXISTS posts_category_idx ON posts (category);

CREATE TABLE IF NOT EXISTS post_helpful (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, post_id)
);

CREATE TABLE IF NOT EXISTS distress_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  message TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  ttl_minutes INTEGER NOT NULL DEFAULT 45,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS distress_expires_idx ON distress_events (expires_at);

CREATE TABLE IF NOT EXISTS borders (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  country_a TEXT NOT NULL,
  country_b TEXT NOT NULL,
  wait_minutes INTEGER NOT NULL DEFAULT 30,
  active_users_reporting INTEGER NOT NULL DEFAULT 0,
  hero_image_url TEXT,
  rules_json JSONB NOT NULL DEFAULT '[]'::jsonb
);

-- Gruppen & Chat
CREATE TABLE IF NOT EXISTS groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('trip', 'permanent')),
  invite_code TEXT UNIQUE NOT NULL,
  created_by UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id UUID NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS group_members_user_idx ON group_members (user_id);

CREATE TABLE IF NOT EXISTS group_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT '' CHECK (char_length(body) <= 4000),
  message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'voice')),
  voice_mime TEXT,
  voice_duration_ms INTEGER,
  voice_storage_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT group_messages_body_rules CHECK (
    (message_type = 'text' AND char_length(body) >= 1) OR message_type = 'voice'
  )
);

CREATE INDEX IF NOT EXISTS group_messages_group_created_idx ON group_messages (group_id, created_at DESC);

-- Kommentare (Social unter Meldungen)
CREATE TABLE IF NOT EXISTS post_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body TEXT NOT NULL DEFAULT '' CHECK (char_length(body) <= 2000),
  message_type TEXT NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'voice')),
  voice_mime TEXT,
  voice_duration_ms INTEGER,
  voice_storage_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT post_comments_body_rules CHECK (
    (message_type = 'text' AND char_length(body) >= 1) OR message_type = 'voice'
  )
);

CREATE INDEX IF NOT EXISTS post_comments_post_idx ON post_comments (post_id, created_at);

-- POI auf der Karte (Community-geteilt)
-- category: parking, border, fuel, rest, hotel, restaurant, mosque, help, other
CREATE TABLE IF NOT EXISTS map_pois (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID REFERENCES users (id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS map_pois_created_idx ON map_pois (created_at DESC);

-- Live-Position auf der Karte (freiwillig, für „Teilnehmer sehen“)
CREATE TABLE IF NOT EXISTS map_live_positions (
  user_id UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS map_live_positions_updated_idx ON map_live_positions (updated_at DESC);
