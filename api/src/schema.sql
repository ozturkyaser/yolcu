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
  toll_vehicle_class TEXT NOT NULL DEFAULT 'car' CHECK (
    toll_vehicle_class IN ('car', 'motorcycle', 'heavy', 'other')
  ),
  stats_km INTEGER NOT NULL DEFAULT 0,
  stats_regions INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
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
  body TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (category IN ('general', 'traffic', 'border', 'help')),
  location_label TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  expires_at TIMESTAMPTZ,
  helpful_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  media_kind TEXT CHECK (media_kind IS NULL OR media_kind IN ('image', 'video')),
  media_storage_key TEXT,
  media_mime TEXT,
  CONSTRAINT posts_need_content CHECK (
    char_length(trim(body)) >= 1
    OR (media_storage_key IS NOT NULL AND char_length(trim(media_storage_key)) >= 1)
  )
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

-- Knowledge Base: Länderhinweise, Maut/Vignette, FAQ (Route-Briefing)
CREATE TABLE IF NOT EXISTS kb_country_facts (
  country_code TEXT NOT NULL CHECK (char_length(country_code) = 2),
  fact_key TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_url TEXT,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (country_code, fact_key)
);

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
);

CREATE INDEX IF NOT EXISTS kb_toll_offers_country_vehicle_idx
  ON kb_toll_offers (country_code, vehicle_class);

CREATE TABLE IF NOT EXISTS kb_route_faq (
  id TEXT PRIMARY KEY,
  corridor TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  tags TEXT[] NOT NULL DEFAULT '{}'::text[],
  source_url TEXT,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Mitfahrt / Ware: Marktplatz
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
);

CREATE INDEX IF NOT EXISTS ride_listings_created_idx ON ride_listings (created_at DESC);
CREATE INDEX IF NOT EXISTS ride_listings_status_idx ON ride_listings (status);

CREATE TABLE IF NOT EXISTS ride_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES ride_listings (id) ON DELETE CASCADE,
  requester_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  request_kind TEXT NOT NULL CHECK (request_kind IN ('passenger', 'cargo')),
  message TEXT NOT NULL DEFAULT '' CHECK (char_length(message) <= 800),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'withdrawn', 'accepted', 'declined')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ride_requests_listing_idx ON ride_requests (listing_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ride_requests_one_pending_per_user
  ON ride_requests (listing_id, requester_id)
  WHERE status = 'pending';

-- Admin gepflegte Tipps: Sıla-Route (Karte + Navigation)
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
);

CREATE INDEX IF NOT EXISTS curated_places_category_idx ON curated_places (category);
CREATE INDEX IF NOT EXISTS curated_places_published_sort_idx ON curated_places (is_published, sort_order DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS curated_places_route_code_idx ON curated_places (route_code) WHERE route_code IS NOT NULL;

-- Vignetten-/Maut-Service: verkaufbare Positionen (Admin) + Kundenanfragen
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
);

CREATE INDEX IF NOT EXISTS vignette_service_products_country_idx ON vignette_service_products (country_code);
CREATE INDEX IF NOT EXISTS vignette_service_products_active_idx ON vignette_service_products (is_active);

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
  paypal_order_id TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vignette_order_requests_created_idx ON vignette_order_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS vignette_order_requests_status_idx ON vignette_order_requests (status);

-- Online-Radio: Streams werden im Admin gepflegt (Icecast/Shoutcast o. ä.)
CREATE TABLE IF NOT EXISTS radio_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(name) >= 1 AND char_length(name) <= 200),
  stream_url TEXT NOT NULL CHECK (char_length(stream_url) >= 8 AND char_length(stream_url) <= 2000),
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS radio_channels_enabled_sort_idx ON radio_channels (enabled, sort_order DESC, name ASC);
