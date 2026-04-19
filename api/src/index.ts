import 'dotenv/config'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import bcrypt from 'bcryptjs'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import { DatabaseError } from 'pg'
import { z } from 'zod'
import { ensureAuthSchemaPatches, runMigrations } from './migrate.js'
import { seedMapSimulationData } from './seedMapSimulation.js'
import { pool } from './pool.js'
import { registerGeocodeRoutes } from './geocoding.js'
import { mapIconSchema } from './mapIcons.js'
import { fetchDrivingRouteOsrm } from './routing.js'
import {
  collectCountriesAlongRoute,
  countryName,
  downsampleLineStringCoordinates,
  productsForCountries,
  type TollVehicleClass,
} from './routeTollAdvice.js'
import { answerWithRouteAssistant } from './routeAssistant.js'
import { registerAdminAndCuratedRoutes } from './adminRoutes.js'
import { registerVignetteServiceRoutes } from './vignetteServiceRoutes.js'
import { registerRideShareRoutes } from './rideShareRoutes.js'
import { registerSocialRoutes } from './socialRoutes.js'
import { registerRadioRoutes } from './radioRoutes.js'
import { registerPromotionRoutes } from './promotionRoutes.js'

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string }
    user: { sub: string; email: string }
  }
}

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(80),
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const postCreateSchema = z.object({
  body: z.string().min(1).max(2000),
  category: z.enum(['general', 'traffic', 'border', 'help']),
  locationLabel: z.string().max(200).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  expiresInHours: z.number().min(1).max(168).optional(),
  /** Strukturierte Sınır-Meldung (optional) */
  borderWaitMinutes: z.number().int().min(0).max(1440).optional(),
  borderSlug: z.string().max(80).optional(),
})

const postReportSchema = z.object({
  reason: z.string().min(3).max(500),
})

const distressSchema = z.object({
  category: z.enum(['breakdown', 'medical', 'unsafe', 'other']),
  message: z.string().max(500).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  ttlMinutes: z.number().min(15).max(120).optional(),
})

const presencePositionSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
})

const vehicleSchema = z.object({
  label: z.string().min(0).max(120).optional(),
  plate: z.string().min(0).max(32).optional(),
  trailerMode: z.boolean().optional(),
})

async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify()
  } catch {
    return reply.status(401).send({ error: 'Nicht angemeldet' })
  }
}

function isLocalDevOrigin(origin: string | undefined): boolean {
  if (!origin) return true
  try {
    const u = new URL(origin)
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1'
  } catch {
    return false
  }
}

function resolveCorsConfig() {
  const raw = process.env.CORS_ORIGIN?.trim()
  const list = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : []
  /** Docker-Image setzt NODE_ENV=production; für lokalen Stack trotzdem localhost-Ports erlauben. */
  const strictProd =
    process.env.NODE_ENV === 'production' && process.env.CORS_RELAX_LOCALHOST !== 'true'

  if (strictProd) {
    return list.length > 0 ? list : true
  }

  // Dev / docker-compose: explizite Liste + alle localhost/127.0.0.1:-Ports (Vite 5174, …)
  return (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => {
    if (!origin) {
      cb(null, true)
      return
    }
    if (list.includes(origin)) {
      cb(null, true)
      return
    }
    if (isLocalDevOrigin(origin)) {
      cb(null, true)
      return
    }
    cb(null, false)
  }
}

async function buildServer() {
  const app = Fastify({ logger: true })

  app.setErrorHandler((rawError, request, reply) => {
    request.log.error(rawError)
    if (reply.sent) return

    if (rawError instanceof DatabaseError) {
      if (rawError.code === '23505') {
        return reply.status(409).send({ error: 'E-Mail bereits registriert' })
      }
      if (rawError.code === '42P01') {
        return reply.status(503).send({
          error:
            'Datenbank-Tabellen fehlen. Starte die API einmalig mit INIT_DB=true oder nutze docker compose (siehe README).',
        })
      }
      if (rawError.code === '42703') {
        return reply.status(503).send({
          error:
            'Datenbank-Schema veraltet. API neu starten (Patches werden beim Start angewendet) oder INIT_DB=true einmalig setzen.',
        })
      }
    }

    const maybePg = rawError as { code?: unknown }
    if (typeof maybePg.code === 'string' && /^[0-9A-Z]{5}$/.test(maybePg.code)) {
      if (maybePg.code === '42P01') {
        return reply.status(503).send({
          error:
            'Datenbank-Tabellen fehlen. Starte die API einmalig mit INIT_DB=true oder nutze docker compose (siehe README).',
        })
      }
      if (maybePg.code === '23505') {
        return reply.status(409).send({ error: 'E-Mail bereits registriert' })
      }
      if (maybePg.code === '42703') {
        return reply.status(503).send({
          error:
            'Datenbank-Schema veraltet. API neu starten oder INIT_DB=true einmalig setzen (siehe README).',
        })
      }
    }

    const error = rawError as Error & { statusCode?: number }
    let nodeCode = (rawError as NodeJS.ErrnoException).code
    if (rawError instanceof AggregateError && rawError.errors?.[0]) {
      nodeCode = (rawError.errors[0] as NodeJS.ErrnoException).code ?? nodeCode
    }
    if (nodeCode === 'ECONNREFUSED' || nodeCode === 'ENOTFOUND' || nodeCode === 'ETIMEDOUT') {
      return reply.status(503).send({
        error:
          'Keine Verbindung zur Datenbank. Prüfe DATABASE_URL und ob Postgres läuft (z. B. docker compose up -d postgres).',
      })
    }

    const status =
      typeof error.statusCode === 'number' && error.statusCode >= 400 ? error.statusCode : 500
    const clientSafe = status < 500 && typeof error.message === 'string'
    const payload = clientSafe
      ? error.message
      : 'Interner Fehler. Siehe API-Logs für Details.'
    return reply.status(status).send({
      error: payload,
      message: payload,
    })
  })

  const jwtSecret = process.env.JWT_SECRET
  if (!jwtSecret || jwtSecret.length < 16) {
    throw new Error('JWT_SECRET muss mindestens 16 Zeichen haben')
  }

  await app.register(cors, {
    origin: resolveCorsConfig(),
    credentials: true,
  })

  await app.register(jwt, { secret: jwtSecret })

  await registerGeocodeRoutes(app)

  await registerSocialRoutes(app)
  await registerRideShareRoutes(app)
  await registerAdminAndCuratedRoutes(app)
  await registerPromotionRoutes(app)
  await registerRadioRoutes(app)
  await registerVignetteServiceRoutes(app)

  app.get('/api/health', async () => ({ ok: true }))

  app.post('/api/auth/register', async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Ungültige Eingabe',
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') || 'Validierung fehlgeschlagen',
        details: parsed.error.flatten(),
      })
    }

    const { email, password, displayName } = parsed.data
    const passwordHash = await bcrypt.hash(password, 10)

    try {
      const r = await pool.query(
        `INSERT INTO users (email, password_hash, display_name)
         VALUES ($1, $2, $3)
         RETURNING id, email, display_name, map_icon, toll_vehicle_class, stats_km, stats_regions, created_at, role`,
        [email.toLowerCase(), passwordHash, displayName],
      )
      const user = r.rows[0]
      const token = await reply.jwtSign({ sub: String(user.id), email: String(user.email) })
      return { token, user: mapUser(user) }
    } catch (e: unknown) {
      const err = e as { code?: string }
      if (err.code === '23505') return reply.status(409).send({ error: 'E-Mail bereits registriert' })
      throw e
    }
  })

  app.post('/api/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Ungültige Eingabe',
        message: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') || 'Validierung fehlgeschlagen',
        details: parsed.error.flatten(),
      })
    }

    const { email, password } = parsed.data
    const r = await pool.query(
      `SELECT id, email, password_hash, display_name, map_icon, toll_vehicle_class, stats_km, stats_regions, created_at, role
       FROM users WHERE email = $1`,
      [email.toLowerCase()],
    )
    const row = r.rows[0]
    let passwordOk = false
    if (row?.password_hash) {
      try {
        passwordOk = await bcrypt.compare(password, row.password_hash)
      } catch {
        passwordOk = false
      }
    }
    if (!row || !passwordOk) {
      return reply.status(401).send({ error: 'E-Mail oder Passwort ungültig' })
    }

    const token = await reply.jwtSign({ sub: String(row.id), email: String(row.email) })
    return {
      token,
      user: mapUser(row),
    }
  })

  app.get('/api/auth/me', { preHandler: authenticate }, async (request) => {
    const r = await pool.query(
      `SELECT id, email, display_name, map_icon, toll_vehicle_class, stats_km, stats_regions, created_at, role FROM users WHERE id = $1`,
      [request.user.sub],
    )
    const user = r.rows[0]
    return { user: user ? mapUser(user) : null }
  })

  app.get('/api/posts', async (request, reply) => {
    const q = z.object({ category: z.enum(['general', 'traffic', 'border', 'help']).optional() }).safeParse(request.query)
    if (!q.success) return reply.status(400).send({ error: q.error.flatten() })

    const category = q.data.category
    const r = await pool.query(
      `SELECT p.id, p.body, p.category, p.location_label, p.lat, p.lng, p.helpful_count, p.expires_at, p.created_at,
              p.border_wait_minutes, p.border_slug, p.media_kind, p.media_storage_key, p.media_mime,
              u.id AS author_id, u.display_name AS author_name, u.map_icon AS author_map_icon
       FROM posts p
       JOIN users u ON u.id = p.user_id
       WHERE ($1::text IS NULL OR p.category = $1)
         AND (p.expires_at IS NULL OR p.expires_at > now())
       ORDER BY p.created_at DESC
       LIMIT 100`,
      [category ?? null],
    )
    return { posts: r.rows.map(mapPost) }
  })

  app.post('/api/posts', { preHandler: authenticate }, async (request, reply) => {
    const parsed = postCreateSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const { body, category, locationLabel, lat, lng, expiresInHours, borderWaitMinutes, borderSlug } =
      parsed.data
    let expiresAt: Date | null = null
    if (expiresInHours) {
      expiresAt = new Date(Date.now() + expiresInHours * 3600 * 1000)
    }

    const bw =
      category === 'border' && borderWaitMinutes != null ? Math.round(borderWaitMinutes) : null
    const bs =
      category === 'border' && borderSlug?.trim()
        ? borderSlug.trim().toLowerCase().slice(0, 80)
        : null

    const r = await pool.query(
      `INSERT INTO posts (user_id, body, category, location_label, lat, lng, expires_at, border_wait_minutes, border_slug)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, body, category, location_label, lat, lng, helpful_count, expires_at, created_at, border_wait_minutes, border_slug`,
      [request.user.sub, body, category, locationLabel ?? null, lat ?? null, lng ?? null, expiresAt, bw, bs],
    )
    const row = r.rows[0]
    const u = await pool.query(`SELECT id, display_name, map_icon FROM users WHERE id = $1`, [request.user.sub])
    const author = u.rows[0]
    return {
      post: mapPost({
        ...row,
        author_id: author.id,
        author_name: author.display_name,
        author_map_icon: author.map_icon,
      }),
    }
  })

  app.post('/api/posts/:id/helpful', { preHandler: authenticate }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const ins = await client.query(
        `INSERT INTO post_helpful (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [request.user.sub, id],
      )
      if (ins.rowCount === 1) {
        await client.query(`UPDATE posts SET helpful_count = helpful_count + 1 WHERE id = $1`, [id])
      }
      await client.query('COMMIT')
    } catch {
      await client.query('ROLLBACK')
      return reply.status(400).send({ error: 'Ungültig' })
    } finally {
      client.release()
    }
    const p = await pool.query(`SELECT helpful_count FROM posts WHERE id = $1`, [id])
    return { helpfulCount: p.rows[0]?.helpful_count ?? 0 }
  })

  app.post('/api/posts/:id/report', { preHandler: authenticate }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const parsed = postReportSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const postExists = await pool.query(`SELECT 1 FROM posts WHERE id = $1`, [id])
    if (!postExists.rowCount) return reply.status(404).send({ error: 'Meldung nicht gefunden' })

    try {
      await pool.query(
        `INSERT INTO post_reports (post_id, reporter_id, reason) VALUES ($1, $2, $3)
         ON CONFLICT (post_id, reporter_id) DO UPDATE SET reason = EXCLUDED.reason, created_at = now()`,
        [id, request.user.sub, parsed.data.reason.trim()],
      )
    } catch {
      return reply.status(400).send({ error: 'Meldung fehlgeschlagen' })
    }
    return { ok: true }
  })

  app.get('/api/profile', { preHandler: authenticate }, async (request, reply) => {
    const u = await pool.query(
      `SELECT id, email, display_name, map_icon, toll_vehicle_class, stats_km, stats_regions, created_at, role FROM users WHERE id = $1`,
      [request.user.sub],
    )
    if (!u.rows[0]) return reply.status(404).send({ error: 'Nicht gefunden' })
    const v = await pool.query(
      `SELECT id, label, plate, trailer_mode, is_primary, created_at FROM vehicles WHERE user_id = $1 ORDER BY created_at DESC`,
      [request.user.sub],
    )
    return { user: mapUser(u.rows[0]), vehicles: v.rows }
  })

  app.put('/api/profile', { preHandler: authenticate }, async (request, reply) => {
    const tollVehicleClassSchema = z.enum(['car', 'motorcycle', 'heavy', 'other'])
    const schema = z
      .object({
        displayName: z.string().min(1).max(80).optional(),
        mapIcon: mapIconSchema.optional(),
        tollVehicleClass: tollVehicleClassSchema.optional(),
      })
      .refine((d) => d.displayName !== undefined || d.mapIcon !== undefined || d.tollVehicleClass !== undefined, {
        message: 'Mindestens Anzeigename, Karten-Icon oder Fahrzeugklasse angeben',
      })
    const parsed = schema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const { displayName, mapIcon, tollVehicleClass } = parsed.data
    if (displayName !== undefined) {
      await pool.query(`UPDATE users SET display_name = $1 WHERE id = $2`, [displayName, request.user.sub])
    }
    if (mapIcon !== undefined) {
      await pool.query(`UPDATE users SET map_icon = $1 WHERE id = $2`, [mapIcon, request.user.sub])
    }
    if (tollVehicleClass !== undefined) {
      await pool.query(`UPDATE users SET toll_vehicle_class = $1 WHERE id = $2`, [tollVehicleClass, request.user.sub])
    }
    const u = await pool.query(
      `SELECT id, email, display_name, map_icon, toll_vehicle_class, stats_km, stats_regions, created_at, role FROM users WHERE id = $1`,
      [request.user.sub],
    )
    return { user: mapUser(u.rows[0]) }
  })

  app.post('/api/vehicles', { preHandler: authenticate }, async (request, reply) => {
    const parsed = vehicleSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const { label = '', plate = '', trailerMode = false } = parsed.data
    await pool.query(`UPDATE vehicles SET is_primary = false WHERE user_id = $1`, [request.user.sub])
    const r = await pool.query(
      `INSERT INTO vehicles (user_id, label, plate, trailer_mode, is_primary)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, label, plate, trailer_mode, is_primary, created_at`,
      [request.user.sub, label, plate, trailerMode],
    )
    return { vehicle: r.rows[0] }
  })

  app.put('/api/vehicles/:id', { preHandler: authenticate }, async (request, reply) => {
    const vid = (request.params as { id: string }).id
    const parsed = vehicleSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const r = await pool.query(
      `UPDATE vehicles SET
         label = COALESCE($1, label),
         plate = COALESCE($2, plate),
         trailer_mode = COALESCE($3, trailer_mode)
       WHERE id = $4 AND user_id = $5
       RETURNING id, label, plate, trailer_mode, is_primary, created_at`,
      [
        parsed.data.label ?? null,
        parsed.data.plate ?? null,
        parsed.data.trailerMode ?? null,
        vid,
        request.user.sub,
      ],
    )
    if (!r.rows[0]) return reply.status(404).send({ error: 'Nicht gefunden' })
    return { vehicle: r.rows[0] }
  })

  app.post('/api/distress', { preHandler: authenticate }, async (request, reply) => {
    const parsed = distressSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const c = await pool.query(
      `SELECT COUNT(*)::int AS n FROM distress_events
       WHERE user_id = $1 AND created_at > now() - interval '1 hour'`,
      [request.user.sub],
    )
    if ((c.rows[0]?.n ?? 0) >= 5) {
      return reply.status(429).send({ error: 'Zu viele Hilfeanfragen in kurzer Zeit' })
    }

    const ttl = parsed.data.ttlMinutes ?? 45
    const expiresAt = new Date(Date.now() + ttl * 60 * 1000)

    const r = await pool.query(
      `INSERT INTO distress_events (user_id, category, message, lat, lng, ttl_minutes, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, category, created_at, expires_at`,
      [
        request.user.sub,
        parsed.data.category,
        parsed.data.message ?? null,
        parsed.data.lat ?? null,
        parsed.data.lng ?? null,
        ttl,
        expiresAt,
      ],
    )

    return {
      ok: true,
      event: r.rows[0],
      hint: 'Notruf 112 wahren Notfällen vorziehen. Andere Nutzer in der Nähe können informiert werden, sobald Push aktiv ist.',
    }
  })

  app.post('/api/presence', { preHandler: authenticate }, async (request, reply) => {
    const parsed = presencePositionSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    await pool.query(
      `INSERT INTO map_live_positions (user_id, lat, lng, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, updated_at = now()`,
      [request.user.sub, parsed.data.lat, parsed.data.lng],
    )
    return { ok: true }
  })

  app.delete('/api/presence', { preHandler: authenticate }, async (request) => {
    await pool.query(`DELETE FROM map_live_positions WHERE user_id = $1`, [request.user.sub])
    return { ok: true }
  })

  app.get('/api/presence/nearby', async (request, reply) => {
    const q = z
      .object({
        lat: z.coerce.number().min(-90).max(90),
        lng: z.coerce.number().min(-180).max(180),
        radiusKm: z.coerce.number().min(1).max(500).optional().default(120),
        maxAgeMinutes: z.coerce.number().min(1).max(60).optional().default(12),
        groupId: z.string().uuid().optional(),
      })
      .safeParse(request.query)
    if (!q.success) return reply.status(400).send({ error: q.error.flatten() })

    const { lat, lng, radiusKm, maxAgeMinutes, groupId } = q.data
    const dLat = radiusKm / 111
    const cosLat = Math.cos((lat * Math.PI) / 180)
    const dLng = radiusKm / (111 * Math.max(Math.abs(cosLat), 0.2))

    if (groupId) {
      try {
        await request.jwtVerify()
      } catch {
        return reply.status(401).send({ error: 'Anmeldung nötig für Gruppenfilter' })
      }
      const mem = await pool.query(
        `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2`,
        [groupId, request.user.sub],
      )
      if (!mem.rowCount) {
        return reply.status(403).send({ error: 'Keine Mitgliedschaft in dieser Gruppe' })
      }
    }

    const sql = groupId
      ? `SELECT p.user_id, p.lat, p.lng, p.updated_at, u.display_name, u.map_icon
         FROM map_live_positions p
         JOIN users u ON u.id = p.user_id
         INNER JOIN group_members gm ON gm.user_id = p.user_id AND gm.group_id = $6::uuid
         WHERE p.updated_at > now() - ($5::integer * interval '1 minute')
           AND p.lat BETWEEN $1 - $2 AND $1 + $2
           AND p.lng BETWEEN $3 - $4 AND $3 + $4
         ORDER BY p.updated_at DESC
         LIMIT 200`
      : `SELECT p.user_id, p.lat, p.lng, p.updated_at, u.display_name, u.map_icon
         FROM map_live_positions p
         JOIN users u ON u.id = p.user_id
         WHERE p.updated_at > now() - ($5::integer * interval '1 minute')
           AND p.lat BETWEEN $1 - $2 AND $1 + $2
           AND p.lng BETWEEN $3 - $4 AND $3 + $4
         ORDER BY p.updated_at DESC
         LIMIT 200`

    const params = groupId ? [lat, dLat, lng, dLng, maxAgeMinutes, groupId] : [lat, dLat, lng, dLng, maxAgeMinutes]
    const r = await pool.query(sql, params)
    return {
      participants: r.rows.map((row) => ({
        userId: row.user_id,
        displayName: row.display_name,
        mapIcon: row.map_icon ?? 'person',
        lat: row.lat,
        lng: row.lng,
        updatedAt: row.updated_at,
      })),
    }
  })

  app.get('/api/route/driving', async (request, reply) => {
    const q = z
      .object({
        fromLat: z.coerce.number().min(-90).max(90),
        fromLng: z.coerce.number().min(-180).max(180),
        toLat: z.coerce.number().min(-90).max(90),
        toLng: z.coerce.number().min(-180).max(180),
      })
      .safeParse(request.query)
    if (!q.success) return reply.status(400).send({ error: q.error.flatten() })

    const base = process.env.OSRM_URL?.trim() || 'https://router.project-osrm.org'
    const result = await fetchDrivingRouteOsrm(
      base,
      q.data.fromLat,
      q.data.fromLng,
      q.data.toLat,
      q.data.toLng,
    )
    if ('error' in result) return reply.status(result.status).send({ error: result.error })
    return result
  })

  const tollAdviceBodySchema = z.object({
    geometry: z.object({
      type: z.literal('LineString'),
      coordinates: z.array(z.tuple([z.number(), z.number()])).min(2).max(25_000),
    }),
    vehicleClass: z.enum(['car', 'motorcycle', 'heavy', 'other']),
  })

  app.post('/api/route/toll-advice', async (request, reply) => {
    const parsed = tollAdviceBodySchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const ua =
      process.env.GEOCODING_USER_AGENT?.trim() ||
      'YolArkadasim/1.0 (dev@yol.local; setze GEOCODING_USER_AGENT in .env laut OSM-Nominatim)'

    let coords = parsed.data.geometry.coordinates as [number, number][]
    if (coords.length > 24_000) coords = downsampleLineStringCoordinates(coords, 24_000)
    const vehicleClass = parsed.data.vehicleClass as TollVehicleClass

    try {
      const hits = await collectCountriesAlongRoute(coords, ua, {
        maxReverseCalls: 22,
        maxGapMidpoints: 16,
        minGapMidpointM: 62_000,
        delayMs: 1050,
      })
      const countryCodes = hits.map((h) => h.countryCode)
      const products = productsForCountries(countryCodes, vehicleClass).map((p) => ({
        id: p.id,
        countryCode: p.countryCode,
        title: p.title,
        description: p.description,
        type: p.type,
        vehicleClasses: p.vehicleClasses,
        purchaseUrl: p.purchaseUrl,
      }))
      const countries = hits.map((h) => ({ code: h.countryCode, name: countryName(h.countryCode) }))
      return {
        vehicleClass,
        countries,
        products,
        disclaimer:
          'Orientierungshilfe ohne Gewähr. Preise, Gültigkeit und Pflichten bitte auf den verlinkten offiziellen Seiten prüfen.',
      }
    } catch (err) {
      request.log.warn({ err }, 'route toll-advice failed')
      return reply.status(503).send({ error: 'Vignetten-Infos vorübergehend nicht verfügbar.' })
    }
  })

  const routeBriefingBodySchema = z.object({
    geometry: z.object({
      type: z.literal('LineString'),
      coordinates: z.array(z.tuple([z.number(), z.number()])).min(2).max(25_000),
    }),
    vehicleClass: z.enum(['car', 'motorcycle', 'heavy', 'other']),
    corridor: z.string().max(80).optional().default('berlin_turkey'),
  })

  app.post('/api/route/briefing', async (request, reply) => {
    const parsed = routeBriefingBodySchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const ua =
      process.env.GEOCODING_USER_AGENT?.trim() ||
      'YolArkadasim/1.0 (dev@yol.local; setze GEOCODING_USER_AGENT in .env laut OSM-Nominatim)'
    const vehicleClass = parsed.data.vehicleClass as TollVehicleClass
    const corridor = parsed.data.corridor
    let coords = parsed.data.geometry.coordinates as [number, number][]
    if (coords.length > 24_000) coords = downsampleLineStringCoordinates(coords, 24_000)
    try {
      const hits = await collectCountriesAlongRoute(coords, ua, {
        maxReverseCalls: 22,
        maxGapMidpoints: 16,
        minGapMidpointM: 62_000,
        delayMs: 1050,
      })
      const countryCodes = hits.map((h) => h.countryCode)
      const countries = hits.map((h) => ({ code: h.countryCode, name: countryName(h.countryCode) }))

      const factsRes =
        countryCodes.length > 0
          ? await pool.query(
              `SELECT country_code, fact_key, title, content, source_url, verified_at
               FROM kb_country_facts
               WHERE country_code = ANY($1::text[])
               ORDER BY country_code, fact_key`,
              [countryCodes],
            )
          : { rows: [] as Array<Record<string, unknown>> }

      const tollRes =
        countryCodes.length > 0
          ? await pool.query(
              `SELECT id, country_code, vehicle_class, kind, title, description, purchase_url, source_url, verified_at
               FROM kb_toll_offers
               WHERE country_code = ANY($1::text[])
                 AND (vehicle_class = $2 OR vehicle_class = 'other')
               ORDER BY country_code, title`,
              [countryCodes, vehicleClass],
            )
          : { rows: [] as Array<Record<string, unknown>> }

      const faqRes = await pool.query(
        `SELECT id, question, answer, tags, source_url, verified_at
         FROM kb_route_faq
         WHERE corridor = $1
         ORDER BY id
         LIMIT 12`,
        [corridor],
      )

      return {
        corridor,
        vehicleClass,
        countries,
        countryFacts: factsRes.rows.map((r) => ({
          countryCode: String(r.country_code),
          key: String(r.fact_key),
          title: String(r.title),
          content: String(r.content),
          sourceUrl: r.source_url ? String(r.source_url) : null,
          verifiedAt: String(r.verified_at),
        })),
        tollOffers: tollRes.rows.map((r) => ({
          id: String(r.id),
          countryCode: String(r.country_code),
          vehicleClass: String(r.vehicle_class),
          kind: String(r.kind),
          title: String(r.title),
          description: String(r.description),
          purchaseUrl: String(r.purchase_url),
          sourceUrl: r.source_url ? String(r.source_url) : null,
          verifiedAt: String(r.verified_at),
        })),
        faq: faqRes.rows.map((r) => ({
          id: String(r.id),
          question: String(r.question),
          answer: String(r.answer),
          tags: Array.isArray(r.tags) ? r.tags.map((x: unknown) => String(x)) : [],
          sourceUrl: r.source_url ? String(r.source_url) : null,
          verifiedAt: String(r.verified_at),
        })),
        disclaimer:
          'Hinweise dienen der Planung. Rechtliche Vorgaben, Preise und Verfügbarkeit immer bei offiziellen Stellen prüfen.',
      }
    } catch (err) {
      request.log.warn({ err }, 'route briefing failed')
      return reply.status(503).send({ error: 'Route-Briefing aktuell nicht verfügbar.' })
    }
  })

  const assistantAskBodySchema = z.object({
    question: z.string().min(3).max(1200),
    corridor: z.string().max(80).optional().default('berlin_turkey'),
    vehicleClass: z.enum(['car', 'motorcycle', 'heavy', 'other']).optional().default('car'),
    geometry: z
      .object({
        type: z.literal('LineString'),
        coordinates: z.array(z.tuple([z.number(), z.number()])).min(2).max(25_000),
      })
      .optional(),
    /** Mitglieder-Kontext: letzte Textnachrichten + optionale KI-Memories dieser Gruppe. */
    groupId: z.string().uuid().optional(),
    /** Antwort in Gruppen-KI-Speicher legen (nur mit groupId + Anmeldung). */
    saveMemory: z.boolean().optional().default(false),
  })

  app.post('/api/assistant/ask', async (request, reply) => {
    const parsed = assistantAskBodySchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    let authedUserId: string | null = null
    let groupChatExcerpt: string | null = null
    let priorMemoryExcerpt: string | null = null

    if (parsed.data.groupId) {
      try {
        await request.jwtVerify()
      } catch {
        return reply.status(401).send({ error: 'Anmeldung nötig für KI mit Gruppenkontext' })
      }
      authedUserId = request.user.sub
      const mem = await pool.query(
        `SELECT 1 FROM group_members WHERE group_id = $1::uuid AND user_id = $2::uuid`,
        [parsed.data.groupId, authedUserId],
      )
      if (!mem.rowCount) {
        return reply.status(403).send({ error: 'Keine Mitgliedschaft in dieser Gruppe' })
      }

      const maxChat = Math.min(
        120,
        Math.max(8, Number(process.env.AI_GROUP_CHAT_MAX_MESSAGES ?? 60) || 60),
      )
      const chatRes = await pool.query<{ author_name: string; body: string; created_at: Date }>(
        `SELECT u.display_name AS author_name, gm.body, gm.created_at
         FROM group_messages gm
         JOIN users u ON u.id = gm.user_id
         WHERE gm.group_id = $1::uuid
           AND gm.message_type = 'text'
           AND char_length(trim(gm.body)) > 0
         ORDER BY gm.created_at DESC
         LIMIT $2`,
        [parsed.data.groupId, maxChat],
      )
      const chronological = [...chatRes.rows].reverse()
      groupChatExcerpt = chronological
        .map((r) => {
          const t = new Date(r.created_at).toISOString().slice(0, 16)
          const body = String(r.body).replace(/\s+/g, ' ').trim().slice(0, 500)
          return `[${t}] ${r.author_name}: ${body}`
        })
        .join('\n')

      try {
        const memRes = await pool.query<{ question: string; answer: string; created_at: Date }>(
          `SELECT question, answer, created_at
           FROM assistant_memory
           WHERE group_id = $1::uuid
           ORDER BY created_at DESC
           LIMIT 24`,
          [parsed.data.groupId],
        )
        const rows = [...memRes.rows].reverse()
        if (rows.length > 0) {
          priorMemoryExcerpt = rows
            .map((r) => {
              const t = new Date(r.created_at).toISOString().slice(0, 16)
              return `[${t}] Frage: ${String(r.question).slice(0, 400)}\nAntwort: ${String(r.answer).slice(0, 900)}`
            })
            .join('\n---\n')
        }
      } catch {
        /* Tabelle assistant_memory kann auf sehr alten DBs fehlen */
      }
    }

    const ua =
      process.env.GEOCODING_USER_AGENT?.trim() ||
      'YolArkadasim/1.0 (dev@yol.local; setze GEOCODING_USER_AGENT in .env laut OSM-Nominatim)'

    try {
      let countryCodes: string[] = []
      let countries: Array<{ code: string; name: string }> = []
      if (parsed.data.geometry) {
        let gcoords = parsed.data.geometry.coordinates as [number, number][]
        if (gcoords.length > 24_000) gcoords = downsampleLineStringCoordinates(gcoords, 24_000)
        const hits = await collectCountriesAlongRoute(gcoords, ua, {
          maxReverseCalls: 22,
          maxGapMidpoints: 16,
          minGapMidpointM: 62_000,
          delayMs: 1050,
        })
        countryCodes = hits.map((h) => h.countryCode)
        countries = hits.map((h) => ({ code: h.countryCode, name: countryName(h.countryCode) }))
      }

      const factsRes =
        countryCodes.length > 0
          ? await pool.query(
              `SELECT country_code, title, content, source_url
               FROM kb_country_facts
               WHERE country_code = ANY($1::text[])
               ORDER BY country_code, fact_key`,
              [countryCodes],
            )
          : await pool.query(
              `SELECT country_code, title, content, source_url
               FROM kb_country_facts
               ORDER BY verified_at DESC
               LIMIT 12`,
            )

      const tollRes =
        countryCodes.length > 0
          ? await pool.query(
              `SELECT country_code, title, description, kind, purchase_url, source_url
               FROM kb_toll_offers
               WHERE country_code = ANY($1::text[])
                 AND (vehicle_class = $2 OR vehicle_class = 'other')
               ORDER BY country_code, title`,
              [countryCodes, parsed.data.vehicleClass],
            )
          : await pool.query(
              `SELECT country_code, title, description, kind, purchase_url, source_url
               FROM kb_toll_offers
               WHERE vehicle_class = $1 OR vehicle_class = 'other'
               ORDER BY verified_at DESC
               LIMIT 12`,
              [parsed.data.vehicleClass],
            )

      const faqRes = await pool.query(
        `SELECT question, answer, source_url
         FROM kb_route_faq
         WHERE corridor = $1
         ORDER BY id
         LIMIT 10`,
        [parsed.data.corridor],
      )

      const ai = await answerWithRouteAssistant({
        question: parsed.data.question,
        corridor: parsed.data.corridor,
        vehicleClass: parsed.data.vehicleClass as TollVehicleClass,
        countries,
        facts: factsRes.rows.map((r) => ({
          countryCode: String(r.country_code),
          title: String(r.title),
          content: String(r.content),
          sourceUrl: r.source_url ? String(r.source_url) : null,
        })),
        tollOffers: tollRes.rows.map((r) => ({
          countryCode: String(r.country_code),
          title: String(r.title),
          description: String(r.description),
          kind: String(r.kind),
          purchaseUrl: String(r.purchase_url),
          sourceUrl: r.source_url ? String(r.source_url) : null,
        })),
        faq: faqRes.rows.map((r) => ({
          question: String(r.question),
          answer: String(r.answer),
          sourceUrl: r.source_url ? String(r.source_url) : null,
        })),
        groupChatExcerpt: groupChatExcerpt ?? undefined,
        priorMemoryExcerpt: priorMemoryExcerpt ?? undefined,
      })

      if (parsed.data.saveMemory && parsed.data.groupId && authedUserId) {
        try {
          await pool.query(
            `INSERT INTO assistant_memory (group_id, user_id, question, answer)
             VALUES ($1::uuid, $2::uuid, $3, $4)`,
            [
              parsed.data.groupId,
              authedUserId,
              parsed.data.question.slice(0, 2000),
              ai.answer.slice(0, 8000),
            ],
          )
        } catch (e) {
          request.log.warn({ err: e }, 'assistant_memory insert skipped')
        }
      }

      return {
        answer: ai.answer,
        citations: ai.citations,
        usedModel: ai.usedModel,
        countries,
        disclaimer:
          'KI-Hinweise dienen der Orientierung. Rechtliches, Preise und Verfügbarkeit immer bei offiziellen Stellen prüfen.',
      }
    } catch (err) {
      request.log.warn({ err }, 'assistant ask failed')
      return reply.status(503).send({ error: 'Assistent aktuell nicht verfügbar.' })
    }
  })

  app.get('/api/borders/:slug', async (request, reply) => {
    const slug = (request.params as { slug: string }).slug
    const r = await pool.query(`SELECT * FROM borders WHERE slug = $1`, [slug])
    if (!r.rows[0]) return reply.status(404).send({ error: 'Nicht gefunden' })
    const b = r.rows[0]
    return {
      border: {
        slug: b.slug,
        title: b.title,
        countryA: b.country_a,
        countryB: b.country_b,
        waitMinutes: b.wait_minutes,
        activeUsersReporting: b.active_users_reporting,
        heroImageUrl: b.hero_image_url,
        rules: b.rules_json,
      },
    }
  })

  return app
}

function mapUser(row: {
  id: string
  email: string
  display_name: string
  map_icon?: string | null
  toll_vehicle_class?: string | null
  stats_km: number
  stats_regions: number
  created_at: Date
  role?: string | null
}) {
  const tvc = row.toll_vehicle_class
  const tollVehicleClass: TollVehicleClass =
    tvc === 'motorcycle' || tvc === 'heavy' || tvc === 'other' || tvc === 'car' ? tvc : 'car'
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    mapIcon: row.map_icon ?? 'person',
    tollVehicleClass,
    statsKm: row.stats_km,
    statsRegions: row.stats_regions,
    createdAt: row.created_at,
    role: row.role === 'admin' ? ('admin' as const) : ('user' as const),
  }
}

function mapPost(row: {
  id: string
  body: string
  category: string
  location_label: string | null
  lat: number | null
  lng: number | null
  helpful_count: number
  expires_at: Date | null
  created_at: Date
  author_id: string
  author_name: string
  border_wait_minutes?: number | null
  border_slug?: string | null
  media_kind?: string | null
  media_storage_key?: string | null
  media_mime?: string | null
  author_map_icon?: string | null
}) {
  const mk = row.media_kind
  const mediaKind = mk === 'image' || mk === 'video' ? mk : null
  return {
    id: row.id,
    body: row.body,
    category: row.category,
    locationLabel: row.location_label,
    lat: row.lat,
    lng: row.lng,
    helpfulCount: row.helpful_count,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    borderWaitMinutes: row.border_wait_minutes ?? null,
    borderSlug: row.border_slug ?? null,
    mediaKind,
    mediaUrl: row.media_storage_key ? `/api/posts/${row.id}/media` : null,
    author: {
      id: row.author_id,
      displayName: row.author_name,
      mapIcon: row.author_map_icon && row.author_map_icon.length > 0 ? row.author_map_icon : 'person',
    },
  }
}

const port = Number(process.env.PORT ?? 4000)
const host = process.env.HOST ?? '0.0.0.0'

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error(
      'Konfigurationsfehler: DATABASE_URL ist nicht gesetzt. Kopiere api/.env.example nach api/.env und passe die Werte an.',
    )
    process.exit(1)
  }

  await ensureAuthSchemaPatches()

  if (process.env.INIT_DB === 'true') {
    await runMigrations()
  }

  if (process.env.SEED_MAP_SIMULATION === 'true') {
    await seedMapSimulationData()
  }

  const app = await buildServer()
  await app.listen({ port, host })
  console.log(`API http://${host}:${port}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
