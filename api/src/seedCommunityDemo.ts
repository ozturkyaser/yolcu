import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { pool } from './pool.js'
import { ensureVoiceDir, postMediaDiskPath } from './voiceStorage.js'

/** Gleicher bcrypt wie Karten-Simulation (`sim123456`) – nur für lokale Demo-Accounts. */
const DEMO_PASSWORD_HASH = '$2a$10$H6ipNJdBzCncU39a/EEVN.D2nRzKqFN3CZGVldDBSj/3V3TeVh4eq'

/** 1×1 PNG (transparent), Platzhalter für Foto-Post. */
const DEMO_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

type DemoUser = { email: string; displayName: string; mapIcon: string }

const DEMO_USERS: DemoUser[] = [
  { email: 'community-demo-ayse@yol.local', displayName: 'Ayşe', mapIcon: 'family_restroom' },
  { email: 'community-demo-mehmet@yol.local', displayName: 'Mehmet', mapIcon: 'directions_car' },
  { email: 'community-demo-zeynep@yol.local', displayName: 'Zeynep', mapIcon: 'badge' },
  { email: 'community-demo-can@yol.local', displayName: 'Can', mapIcon: 'rv_hookup' },
]

/**
 * Legt Demo-Community-Beiträge an, wenn `posts` leer ist (idempotent).
 * Läuft bei API-Migration (`runMigrations`).
 */
export async function seedCommunityDemoPostsIfEmpty(): Promise<void> {
  const c = await pool.query(`SELECT COUNT(*)::int AS n FROM posts`)
  if ((c.rows[0]?.n ?? 0) > 0) return

  const userIds: string[] = []
  for (const u of DEMO_USERS) {
    await pool.query(
      `INSERT INTO users (email, password_hash, display_name, map_icon)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING`,
      [u.email, DEMO_PASSWORD_HASH, u.displayName, u.mapIcon],
    )
    const q = await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [u.email])
    const id = q.rows[0]?.id
    if (id) userIds.push(id)
  }

  if (userIds.length === 0) return

  const uid = (i: number) => userIds[Math.min(i, userIds.length - 1)]!

  type Row = {
    userIdx: number
    hoursAgo: number
    body: string
    category: 'general' | 'traffic' | 'border' | 'help'
    locationLabel: string | null
    helpful: number
    borderWait?: number | null
    borderSlug?: string | null
    media?: 'image'
  }

  const rows: Row[] = [
    {
      userIdx: 0,
      hoursAgo: 0,
      body:
        'A3 Richtung Nürnberg: dichtes Verkehrsaufkommen, aber flüssig. Keine Baustelle gesehen.',
      category: 'traffic',
      locationLabel: 'A3 bei Erlangen',
      helpful: 12,
    },
    {
      userIdx: 1,
      hoursAgo: 2,
      body: 'Gerade durch die Kontrolle – insgesamt ca. 45–60 Min. gewartet. Alles ruhig.',
      category: 'border',
      locationLabel: 'Horgos / Röszke',
      helpful: 48,
      borderWait: 55,
      borderSlug: 'horgos',
    },
    {
      userIdx: 2,
      hoursAgo: 5,
      body:
        'Kennt jemand einen sicheren Kurzzeit-Parkplatz für Wohnmobil kurz vor der serbischen Grenze? Danke!',
      category: 'help',
      locationLabel: null,
      helpful: 7,
    },
    {
      userIdx: 3,
      hoursAgo: 8,
      body: 'Schöne Fahrt heute – vielen Dank an alle, die hier Infos teilen.',
      category: 'general',
      locationLabel: null,
      helpful: 23,
    },
    {
      userIdx: 0,
      hoursAgo: 12,
      body: 'A99 München – aktuell flüssig, gute Sicht.',
      category: 'traffic',
      locationLabel: 'A99',
      helpful: 5,
    },
    {
      userIdx: 1,
      hoursAgo: 18,
      body: 'Unterwegs Richtung Süden – Sonne und gute Stimmung.',
      category: 'general',
      locationLabel: null,
      helpful: 31,
      media: 'image',
    },
  ]

  ensureVoiceDir()

  for (const r of rows) {
    const postId = randomUUID()
    let mediaKind: string | null = null
    let mediaStorageKey: string | null = null
    let mediaMime: string | null = null

    if (r.media === 'image') {
      mediaKind = 'image'
      mediaStorageKey = `p-${postId}.png`
      mediaMime = 'image/png'
      writeFileSync(postMediaDiskPath(mediaStorageKey), DEMO_PNG)
    }

    await pool.query(
      `INSERT INTO posts (
         id, user_id, body, category, location_label, lat, lng, expires_at,
         helpful_count, created_at, border_wait_minutes, border_slug,
         media_kind, media_storage_key, media_mime
       ) VALUES (
         $1, $2, $3, $4, $5, NULL, NULL, NULL,
         $6, NOW() - ($7 * INTERVAL '1 hour'),
         $8, $9,
         $10, $11, $12
       )`,
      [
        postId,
        uid(r.userIdx),
        r.body,
        r.category,
        r.locationLabel,
        r.helpful,
        r.hoursAgo,
        r.borderWait ?? null,
        r.borderSlug ?? null,
        mediaKind,
        mediaStorageKey,
        mediaMime,
      ],
    )
  }

  console.log(
    '[seedCommunityDemo] OK: Demo-Community-Posts angelegt (nur bei leerer posts-Tabelle). Login z. B. community-demo-ayse@yol.local / sim123456',
  )
}
