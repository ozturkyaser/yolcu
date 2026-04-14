import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { isMailConfigured, vignetteAdminNotifyEmail } from './mail.js'
import { getPayPalConfig } from './paypalClient.js'
import { pool } from './pool.js'
import { getStripe, publicWebAppBaseUrl } from './stripeClient.js'

async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify()
  } catch {
    return reply.status(401).send({ error: 'Nicht angemeldet' })
  }
}

async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const r = await pool.query<{ role: string }>(`SELECT role FROM users WHERE id = $1`, [
    (request.user as { sub: string }).sub,
  ])
  if (r.rows[0]?.role !== 'admin') {
    return reply.status(403).send({ error: 'Adminrechte erforderlich' })
  }
}

const curatedPlaceCreateSchema = z.object({
  category: z.enum(['accommodation', 'restaurant', 'rest_area']),
  name: z.string().min(1).max(200),
  description: z.string().max(4000).optional().default(''),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().max(400).optional().default(''),
  region: z.string().max(160).optional().default(''),
  phone: z.string().max(80).optional().default(''),
  website: z.string().max(500).optional().default(''),
  imageUrl: z.string().max(800).optional().default(''),
  isPublished: z.boolean().optional().default(true),
  sortOrder: z.number().int().optional().default(0),
})

const curatedPlacePatchSchema = curatedPlaceCreateSchema.partial()

const adminUserPatchSchema = z.object({
  role: z.enum(['user', 'admin']).optional(),
  displayName: z.string().min(1).max(80).optional(),
})

function stripeKeyKind(): 'test' | 'live' | 'custom' | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  if (!key) return null
  if (key.startsWith('sk_test_')) return 'test'
  if (key.startsWith('sk_live_')) return 'live'
  return 'custom'
}

function paypalClientIdPreview(id: string): string {
  const t = id.trim()
  if (t.length <= 14) return `${t.slice(0, 6)}…`
  return `${t.slice(0, 10)}…${t.slice(-4)}`
}

function mapCuratedRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    category: row.category,
    name: row.name,
    description: row.description,
    lat: Number(row.lat),
    lng: Number(row.lng),
    address: row.address,
    region: row.region,
    phone: row.phone,
    website: row.website,
    imageUrl: row.image_url,
    isPublished: row.is_published,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function registerAdminAndCuratedRoutes(app: FastifyInstance) {
  app.get('/api/curated-places', async (request, reply) => {
    const q = z
      .object({
        category: z.enum(['accommodation', 'restaurant', 'rest_area']).optional(),
      })
      .safeParse(request.query)
    if (!q.success) return reply.status(400).send({ error: q.error.flatten() })

    const cat = q.data.category
    const r = await pool.query(
      `SELECT id, category, name, description, lat, lng, address, region, phone, website, image_url,
              is_published, sort_order, created_at, updated_at
       FROM curated_places
       WHERE is_published = true
         AND ($1::text IS NULL OR category = $1)
       ORDER BY sort_order DESC, name ASC
       LIMIT 300`,
      [cat ?? null],
    )
    return { places: r.rows.map(mapCuratedRow) }
  })

  app.get('/api/admin/stats', { preHandler: [authenticate, requireAdmin] }, async () => {
    const [u, p, po, rl, rr, vp, vo] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM users`),
      pool.query(`SELECT COUNT(*)::int AS n FROM posts`),
      pool.query(`SELECT COUNT(*)::int AS n FROM curated_places`),
      pool.query(`SELECT COUNT(*)::int AS n FROM ride_listings`),
      pool.query(`SELECT COUNT(*)::int AS n FROM ride_requests`),
      pool.query(`SELECT COUNT(*)::int AS n FROM vignette_service_products`),
      pool.query(`SELECT COUNT(*)::int AS n FROM vignette_order_requests`),
    ])
    return {
      stats: {
        users: u.rows[0]?.n ?? 0,
        posts: p.rows[0]?.n ?? 0,
        curatedPlaces: po.rows[0]?.n ?? 0,
        rideListings: rl.rows[0]?.n ?? 0,
        rideRequests: rr.rows[0]?.n ?? 0,
        vignetteProducts: vp.rows[0]?.n ?? 0,
        vignetteOrders: vo.rows[0]?.n ?? 0,
      },
    }
  })

  /** Keine Geheimnisse – nur Status & URLs für Betrieb/Dokumentation. */
  app.get('/api/admin/payment-settings', { preHandler: [authenticate, requireAdmin] }, async () => {
    const base = publicWebAppBaseUrl()
    const pp = getPayPalConfig()
    const live = process.env.PAYPAL_MODE === 'live'
    const adminMail = vignetteAdminNotifyEmail()
    const adminMailHint =
      adminMail && adminMail.includes('@')
        ? `${adminMail.slice(0, 1)}…${adminMail.slice(adminMail.indexOf('@'))}`
        : adminMail
          ? 'gesetzt'
          : null
    return {
      publicWebAppUrl: base,
      envVarsDoc: {
        stripe: ['STRIPE_SECRET_KEY'],
        paypal: ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_MODE (sandbox|live)'],
        appUrl: ['PUBLIC_WEB_APP_URL'],
        mail: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'VIGNETTE_ADMIN_EMAIL'],
      },
      stripe: {
        configured: Boolean(getStripe()),
        keyKind: stripeKeyKind(),
      },
      paypal: {
        configured: Boolean(pp),
        mode: pp ? (live ? ('live' as const) : ('sandbox' as const)) : null,
        clientIdPreview: pp ? paypalClientIdPreview(pp.clientId) : null,
        apiBase: pp?.apiBase ?? null,
      },
      mail: {
        smtpConfigured: isMailConfigured(),
        vignetteAdminEmailSet: Boolean(adminMail),
        vignetteAdminEmailHint: adminMailHint,
      },
      vignetteCheckoutUrls: {
        stripeSuccess: `${base}/profile?vignetteCheckout=success&session_id={CHECKOUT_SESSION_ID}`,
        stripeCancel: `${base}/profile?vignetteCheckout=cancel`,
        paypalReturn: `${base}/profile?vignetteCheckout=paypal_success`,
        paypalCancel: `${base}/profile?vignetteCheckout=paypal_cancel`,
      },
    }
  })

  app.get('/api/admin/users', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).optional().default(80),
        offset: z.coerce.number().int().min(0).optional().default(0),
        q: z.string().max(120).optional(),
      })
      .safeParse(request.query)
    if (!q.success) return reply.status(400).send({ error: q.error.flatten() })

    const { limit, offset, q: needle } = q.data
    const r = await pool.query(
      `SELECT id, email, display_name, role, map_icon, toll_vehicle_class, stats_km, stats_regions, created_at
       FROM users
       WHERE ($3::text IS NULL OR email ILIKE ('%' || $3 || '%') OR display_name ILIKE ('%' || $3 || '%'))
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset, needle?.trim() || null],
    )
    return {
      users: r.rows.map((row) => ({
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        role: row.role,
        mapIcon: row.map_icon,
        tollVehicleClass: row.toll_vehicle_class,
        statsKm: row.stats_km,
        statsRegions: row.stats_regions,
        createdAt: row.created_at,
      })),
    }
  })

  app.patch('/api/admin/users/:id', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const parsed = adminUserPatchSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const exists = await pool.query(`SELECT 1 FROM users WHERE id = $1`, [id])
    if (!exists.rowCount) return reply.status(404).send({ error: 'Nutzer nicht gefunden' })

    const { role, displayName } = parsed.data
    if (role == null && displayName == null) {
      return reply.status(400).send({ error: 'Keine Änderung' })
    }

    if (role === 'user') {
      const cur = await pool.query<{ role: string }>(`SELECT role FROM users WHERE id = $1`, [id])
      if (cur.rows[0]?.role === 'admin') {
        const cnt = await pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin'`)
        if ((cnt.rows[0]?.n ?? 0) < 2) {
          return reply
            .status(400)
            .send({ error: 'Der letzte verbleibende Admin kann nicht zurückgestuft werden.' })
        }
      }
    }

    if (displayName != null) {
      await pool.query(`UPDATE users SET display_name = $1 WHERE id = $2`, [displayName.trim(), id])
    }
    if (role != null) {
      await pool.query(`UPDATE users SET role = $1 WHERE id = $2`, [role, id])
    }

    const r = await pool.query(
      `SELECT id, email, display_name, role, map_icon, toll_vehicle_class, stats_km, stats_regions, created_at FROM users WHERE id = $1`,
      [id],
    )
    const row = r.rows[0]
    return {
      user: {
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        role: row.role,
        mapIcon: row.map_icon,
        tollVehicleClass: row.toll_vehicle_class,
        statsKm: row.stats_km,
        statsRegions: row.stats_regions,
        createdAt: row.created_at,
      },
    }
  })

  app.get('/api/admin/curated-places', { preHandler: [authenticate, requireAdmin] }, async () => {
    const r = await pool.query(
      `SELECT id, category, name, description, lat, lng, address, region, phone, website, image_url,
              is_published, sort_order, created_at, updated_at
       FROM curated_places
       ORDER BY sort_order DESC, created_at DESC`,
    )
    return { places: r.rows.map(mapCuratedRow) }
  })

  app.post('/api/admin/curated-places', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const parsed = curatedPlaceCreateSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const d = parsed.data
    const ins = await pool.query(
      `INSERT INTO curated_places (
         category, name, description, lat, lng, address, region, phone, website, image_url, is_published, sort_order
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id, category, name, description, lat, lng, address, region, phone, website, image_url,
                 is_published, sort_order, created_at, updated_at`,
      [
        d.category,
        d.name.trim(),
        d.description.trim(),
        d.lat,
        d.lng,
        d.address.trim(),
        d.region.trim(),
        d.phone.trim(),
        d.website.trim(),
        d.imageUrl.trim(),
        d.isPublished,
        d.sortOrder,
      ],
    )
    return { place: mapCuratedRow(ins.rows[0]!) }
  })

  app.patch('/api/admin/curated-places/:id', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const parsed = curatedPlacePatchSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const d = parsed.data
    if (Object.keys(d).length === 0) {
      return reply.status(400).send({ error: 'Keine Felder' })
    }

    const cur = await pool.query(`SELECT id FROM curated_places WHERE id = $1`, [id])
    if (!cur.rowCount) return reply.status(404).send({ error: 'Eintrag nicht gefunden' })

    const parts: string[] = []
    const vals: unknown[] = []
    let n = 1
    const add = (col: string, val: unknown) => {
      parts.push(`${col} = $${n}`)
      vals.push(val)
      n += 1
    }
    if (d.category != null) add('category', d.category)
    if (d.name != null) add('name', d.name.trim())
    if (d.description != null) add('description', d.description.trim())
    if (d.lat != null) add('lat', d.lat)
    if (d.lng != null) add('lng', d.lng)
    if (d.address != null) add('address', d.address.trim())
    if (d.region != null) add('region', d.region.trim())
    if (d.phone != null) add('phone', d.phone.trim())
    if (d.website != null) add('website', d.website.trim())
    if (d.imageUrl != null) add('image_url', d.imageUrl.trim())
    if (d.isPublished != null) add('is_published', d.isPublished)
    if (d.sortOrder != null) add('sort_order', d.sortOrder)
    parts.push('updated_at = now()')
    vals.push(id)
    await pool.query(`UPDATE curated_places SET ${parts.join(', ')} WHERE id = $${n}`, vals)

    const r = await pool.query(
      `SELECT id, category, name, description, lat, lng, address, region, phone, website, image_url,
              is_published, sort_order, created_at, updated_at FROM curated_places WHERE id = $1`,
      [id],
    )
    return { place: mapCuratedRow(r.rows[0]!) }
  })

  app.delete('/api/admin/curated-places/:id', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const r = await pool.query(`DELETE FROM curated_places WHERE id = $1 RETURNING id`, [id])
    if (!r.rowCount) return reply.status(404).send({ error: 'Eintrag nicht gefunden' })
    return { ok: true }
  })

  app.get('/api/admin/ride-listings', { preHandler: [authenticate, requireAdmin] }, async () => {
    const r = await pool.query(
      `SELECT l.id, l.offer_kind, l.route_from, l.route_to, l.status, l.created_at,
              u.email AS owner_email, u.display_name AS owner_name
       FROM ride_listings l
       JOIN users u ON u.id = l.user_id
       ORDER BY l.created_at DESC
       LIMIT 200`,
    )
    return {
      listings: r.rows.map((row) => ({
        id: row.id,
        offerKind: row.offer_kind,
        routeFrom: row.route_from,
        routeTo: row.route_to,
        status: row.status,
        createdAt: row.created_at,
        ownerEmail: row.owner_email,
        ownerName: row.owner_name,
      })),
    }
  })

  app.patch('/api/admin/ride-listings/:id', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const parsed = z.object({ status: z.enum(['open', 'closed']) }).safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const u = await pool.query(`UPDATE ride_listings SET status = $1 WHERE id = $2 RETURNING id`, [
      parsed.data.status,
      id,
    ])
    if (!u.rowCount) return reply.status(404).send({ error: 'Eintrag nicht gefunden' })
    return { ok: true, status: parsed.data.status }
  })
}
