import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { isMailConfigured, vignetteAdminNotifyEmail } from './mail.js'
import { getPayPalConfig } from './paypalClient.js'
import { pool } from './pool.js'
import { getStripe, publicWebAppBaseUrl } from './stripeClient.js'
import {
  DEFAULT_OPENROUTER_MODEL,
  isAllowedOpenRouterModelId,
  OPENROUTER_API_BASE,
  OPENROUTER_MODEL_OPTIONS,
} from './openrouter.js'
import { decryptUserAiSecret, encryptUserAiSecret } from './userAiCrypto.js'

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

const routeCodeSchema = z.enum(['A_NORTH', 'B_WEST', 'C_SOUTH', 'COMMON']).nullable().optional()

const curatedPlaceCreateSchema = z.object({
  category: z.enum(['accommodation', 'restaurant', 'rest_area', 'workshop', 'border']),
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
  routeCode: routeCodeSchema,
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
    routeCode: (row.route_code as string | null) ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function registerAdminAndCuratedRoutes(app: FastifyInstance) {
  app.get('/api/curated-places', async (request, reply) => {
    const q = z
      .object({
        category: z.enum(['accommodation', 'restaurant', 'rest_area', 'workshop', 'border']).optional(),
        route: z.enum(['A_NORTH', 'B_WEST', 'C_SOUTH', 'COMMON']).optional(),
      })
      .safeParse(request.query)
    if (!q.success) return reply.status(400).send({ error: q.error.flatten() })

    const cat = q.data.category
    const route = q.data.route
    const r = await pool.query(
      `SELECT id, category, name, description, lat, lng, address, region, phone, website, image_url,
              is_published, sort_order, route_code, created_at, updated_at
       FROM curated_places
       WHERE is_published = true
         AND ($1::text IS NULL OR category = $1)
         AND (
           $2::text IS NULL
           OR route_code IS NULL
           OR route_code = 'COMMON'
           OR route_code = $2
         )
       ORDER BY sort_order DESC, name ASC
       LIMIT 300`,
      [cat ?? null, route ?? null],
    )
    return { places: r.rows.map(mapCuratedRow) }
  })

  app.get('/api/admin/stats', { preHandler: [authenticate, requireAdmin] }, async () => {
    const [u, p, po, rl, rr, vp, vo, pr] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM users`),
      pool.query(`SELECT COUNT(*)::int AS n FROM posts`),
      pool.query(`SELECT COUNT(*)::int AS n FROM curated_places`),
      pool.query(`SELECT COUNT(*)::int AS n FROM ride_listings`),
      pool.query(`SELECT COUNT(*)::int AS n FROM ride_requests`),
      pool.query(`SELECT COUNT(*)::int AS n FROM vignette_service_products`),
      pool.query(`SELECT COUNT(*)::int AS n FROM vignette_order_requests`),
      pool.query(`SELECT COUNT(*)::int AS n FROM promotion_campaigns`),
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
        promotionCampaigns: pr.rows[0]?.n ?? 0,
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

  app.get('/api/admin/ai-settings', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const r = await pool.query<{
      openai_api_key_encrypted: string | null
      ai_model: string | null
      default_extra_system_prompt: string | null
    }>(
      `SELECT openai_api_key_encrypted, ai_model, default_extra_system_prompt
       FROM admin_ai_settings WHERE id = 1`,
    )
    const row = r.rows[0]
    if (!row) {
      return reply.status(503).send({ error: 'admin_ai_settings nicht angelegt (Migration fehlt?)' })
    }
    let apiKeyLast4: string | null = null
    if (row.openai_api_key_encrypted) {
      const dec = decryptUserAiSecret(row.openai_api_key_encrypted)
      if (dec && dec.length >= 4) apiKeyLast4 = dec.slice(-4)
    }
    const storedModel = row.ai_model?.trim() || null
    const aiModel =
      storedModel && isAllowedOpenRouterModelId(storedModel) ? storedModel : DEFAULT_OPENROUTER_MODEL
    return {
      hasApiKey: Boolean(row.openai_api_key_encrypted && apiKeyLast4),
      apiKeyLast4,
      aiModel,
      openRouterApiBase: OPENROUTER_API_BASE,
      availableModels: OPENROUTER_MODEL_OPTIONS,
      defaultExtraSystemPrompt: row.default_extra_system_prompt,
    }
  })

  app.put('/api/admin/ai-settings', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const schema = z.object({
      aiModel: z.union([z.string().max(120), z.null()]).optional(),
      openaiApiKey: z.string().max(800).optional(),
      clearApiKey: z.boolean().optional(),
      defaultExtraSystemPrompt: z.union([z.string().max(8000), z.null()]).optional(),
    })
    const parsed = schema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const { aiModel, openaiApiKey, clearApiKey, defaultExtraSystemPrompt } = parsed.data

    if (aiModel != null && aiModel !== '' && !isAllowedOpenRouterModelId(aiModel)) {
      return reply.status(400).send({ error: 'Modell ist nicht in der erlaubten OpenRouter-Liste' })
    }

    const sets: string[] = []
    const vals: unknown[] = []
    let i = 1

    if (aiModel !== undefined) {
      sets.push(`ai_model = $${i++}`)
      vals.push(aiModel?.trim() || null)
    }
    if (defaultExtraSystemPrompt !== undefined) {
      sets.push(`default_extra_system_prompt = $${i++}`)
      vals.push(defaultExtraSystemPrompt?.trim() || null)
    }

    if (clearApiKey) {
      sets.push(`openai_api_key_encrypted = $${i++}`)
      vals.push(null)
    } else if (openaiApiKey !== undefined) {
      const t = openaiApiKey.trim()
      if (t.length > 0) {
        const enc = encryptUserAiSecret(t)
        if (!enc) {
          return reply.status(503).send({
            error:
              'API-Schlüssel kann nicht gespeichert werden (JWT_SECRET oder AI_USER_SECRET für Verschlüsselung setzen).',
          })
        }
        sets.push(`openai_api_key_encrypted = $${i++}`)
        vals.push(enc)
      }
    }

    if (sets.length === 0) {
      return reply.status(400).send({ error: 'Keine Felder zum Aktualisieren' })
    }
    sets.push(`updated_at = now()`)

    await pool.query(`UPDATE admin_ai_settings SET ${sets.join(', ')} WHERE id = 1`, vals)

    const r = await pool.query<{
      openai_api_key_encrypted: string | null
      ai_model: string | null
      default_extra_system_prompt: string | null
    }>(
      `SELECT openai_api_key_encrypted, ai_model, default_extra_system_prompt
       FROM admin_ai_settings WHERE id = 1`,
    )
    const row = r.rows[0]!
    let apiKeyLast4: string | null = null
    if (row.openai_api_key_encrypted) {
      const dec = decryptUserAiSecret(row.openai_api_key_encrypted)
      if (dec && dec.length >= 4) apiKeyLast4 = dec.slice(-4)
    }
    const storedModel = row.ai_model?.trim() || null
    const resolvedModel =
      storedModel && isAllowedOpenRouterModelId(storedModel) ? storedModel : DEFAULT_OPENROUTER_MODEL
    return {
      ok: true,
      hasApiKey: Boolean(row.openai_api_key_encrypted && apiKeyLast4),
      apiKeyLast4,
      aiModel: resolvedModel,
      openRouterApiBase: OPENROUTER_API_BASE,
      availableModels: OPENROUTER_MODEL_OPTIONS,
      defaultExtraSystemPrompt: row.default_extra_system_prompt,
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
              is_published, sort_order, route_code, created_at, updated_at
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
         category, name, description, lat, lng, address, region, phone, website, image_url, is_published, sort_order, route_code
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, category, name, description, lat, lng, address, region, phone, website, image_url,
                 is_published, sort_order, route_code, created_at, updated_at`,
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
        d.routeCode ?? null,
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
    if (d.routeCode !== undefined) add('route_code', d.routeCode)
    parts.push('updated_at = now()')
    vals.push(id)
    await pool.query(`UPDATE curated_places SET ${parts.join(', ')} WHERE id = $${n}`, vals)

    const r = await pool.query(
      `SELECT id, category, name, description, lat, lng, address, region, phone, website, image_url,
              is_published, sort_order, route_code, created_at, updated_at FROM curated_places WHERE id = $1`,
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

  const promotionFields = z.object({
    internalName: z.string().min(1).max(160),
    headlineDe: z.string().max(240).optional().default(''),
    headlineTr: z.string().max(240).optional().default(''),
    headlineEn: z.string().max(240).optional().default(''),
    bodyDe: z.string().max(1200).optional().default(''),
    bodyTr: z.string().max(1200).optional().default(''),
    bodyEn: z.string().max(1200).optional().default(''),
    imageUrl: z.string().max(800).optional().default(''),
    ctaLabelDe: z.string().max(160).optional().default(''),
    ctaLabelTr: z.string().max(160).optional().default(''),
    ctaLabelEn: z.string().max(160).optional().default(''),
    ctaUrl: z.string().min(8).max(800),
    startsAt: z.string().min(1),
    endsAt: z.string().min(1),
    isActive: z.boolean().optional().default(true),
    priority: z.number().int().optional().default(0),
    /** Nach Schließen/CTA: Mindestabstand bis zur erneuten Anzeige (0 = nur bis Sitzungsende). Max. 7 Tage. */
    showAgainAfterMinutes: z.number().int().min(0).max(10080).optional().default(60),
  })

  function mapPromotionCampaignRow(row: Record<string, unknown>) {
    return {
      id: row.id,
      internalName: row.internal_name,
      headlineDe: row.headline_de,
      headlineTr: row.headline_tr,
      headlineEn: row.headline_en,
      bodyDe: row.body_de,
      bodyTr: row.body_tr,
      bodyEn: row.body_en,
      imageUrl: row.image_url,
      ctaLabelDe: row.cta_label_de,
      ctaLabelTr: row.cta_label_tr,
      ctaLabelEn: row.cta_label_en,
      ctaUrl: row.cta_url,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      isActive: row.is_active,
      priority: row.priority,
      showAgainAfterMinutes: Number(row.show_again_after_minutes ?? 60),
      impressionCount: Number(row.impression_count),
      clickCount: Number(row.click_count),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  app.get('/api/admin/promotions', { preHandler: [authenticate, requireAdmin] }, async () => {
    const r = await pool.query(
      `SELECT id, internal_name, headline_de, headline_tr, headline_en,
              body_de, body_tr, body_en, image_url,
              cta_label_de, cta_label_tr, cta_label_en, cta_url,
              starts_at, ends_at, is_active, priority, show_again_after_minutes,
              impression_count, click_count, created_at, updated_at
       FROM promotion_campaigns
       ORDER BY priority DESC, starts_at DESC`,
    )
    return { campaigns: r.rows.map(mapPromotionCampaignRow) }
  })

  app.post('/api/admin/promotions', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const parsed = promotionFields.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const d = parsed.data
    const t0 = new Date(d.startsAt)
    const t1 = new Date(d.endsAt)
    if (Number.isNaN(t0.getTime()) || Number.isNaN(t1.getTime())) {
      return reply.status(400).send({ error: 'Ungültiges Datum' })
    }
    if (t1 <= t0) return reply.status(400).send({ error: 'Ende muss nach Start liegen' })
    const ins = await pool.query(
      `INSERT INTO promotion_campaigns (
         internal_name, headline_de, headline_tr, headline_en,
         body_de, body_tr, body_en, image_url,
         cta_label_de, cta_label_tr, cta_label_en, cta_url,
         starts_at, ends_at, is_active, priority, show_again_after_minutes
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id, internal_name, headline_de, headline_tr, headline_en,
                 body_de, body_tr, body_en, image_url,
                 cta_label_de, cta_label_tr, cta_label_en, cta_url,
                 starts_at, ends_at, is_active, priority, show_again_after_minutes,
                 impression_count, click_count, created_at, updated_at`,
      [
        d.internalName.trim(),
        d.headlineDe.trim(),
        d.headlineTr.trim(),
        d.headlineEn.trim(),
        d.bodyDe.trim(),
        d.bodyTr.trim(),
        d.bodyEn.trim(),
        d.imageUrl.trim(),
        d.ctaLabelDe.trim(),
        d.ctaLabelTr.trim(),
        d.ctaLabelEn.trim(),
        d.ctaUrl.trim(),
        t0.toISOString(),
        t1.toISOString(),
        d.isActive,
        d.priority,
        d.showAgainAfterMinutes,
      ],
    )
    return { campaign: mapPromotionCampaignRow(ins.rows[0]!) }
  })

  app.patch('/api/admin/promotions/:id', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const parsed = promotionFields.partial().safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const d = parsed.data
    if (Object.keys(d).length === 0) return reply.status(400).send({ error: 'Keine Felder' })

    const cur = await pool.query(`SELECT id FROM promotion_campaigns WHERE id = $1`, [id])
    if (!cur.rowCount) return reply.status(404).send({ error: 'Kampagne nicht gefunden' })

    const parts: string[] = []
    const vals: unknown[] = []
    let n = 1
    const add = (col: string, val: unknown) => {
      parts.push(`${col} = $${n}`)
      vals.push(val)
      n += 1
    }
    if (d.internalName != null) add('internal_name', d.internalName.trim())
    if (d.headlineDe != null) add('headline_de', d.headlineDe.trim())
    if (d.headlineTr != null) add('headline_tr', d.headlineTr.trim())
    if (d.headlineEn != null) add('headline_en', d.headlineEn.trim())
    if (d.bodyDe != null) add('body_de', d.bodyDe.trim())
    if (d.bodyTr != null) add('body_tr', d.bodyTr.trim())
    if (d.bodyEn != null) add('body_en', d.bodyEn.trim())
    if (d.imageUrl != null) add('image_url', d.imageUrl.trim())
    if (d.ctaLabelDe != null) add('cta_label_de', d.ctaLabelDe.trim())
    if (d.ctaLabelTr != null) add('cta_label_tr', d.ctaLabelTr.trim())
    if (d.ctaLabelEn != null) add('cta_label_en', d.ctaLabelEn.trim())
    if (d.ctaUrl != null) add('cta_url', d.ctaUrl.trim())
    if (d.startsAt != null) {
      const t0 = new Date(d.startsAt)
      if (Number.isNaN(t0.getTime())) return reply.status(400).send({ error: 'Ungültiges Startdatum' })
      add('starts_at', t0.toISOString())
    }
    if (d.endsAt != null) {
      const t1 = new Date(d.endsAt)
      if (Number.isNaN(t1.getTime())) return reply.status(400).send({ error: 'Ungültiges Enddatum' })
      add('ends_at', t1.toISOString())
    }
    if (d.isActive != null) add('is_active', d.isActive)
    if (d.priority != null) add('priority', d.priority)
    if (d.showAgainAfterMinutes != null) add('show_again_after_minutes', d.showAgainAfterMinutes)
    parts.push('updated_at = now()')
    vals.push(id)
    await pool.query(`UPDATE promotion_campaigns SET ${parts.join(', ')} WHERE id = $${n}`, vals)

    if (d.startsAt != null || d.endsAt != null) {
      const chk = await pool.query<{ s: string; e: string }>(
        `SELECT starts_at::text AS s, ends_at::text AS e FROM promotion_campaigns WHERE id = $1`,
        [id],
      )
      const s = new Date(chk.rows[0]!.s)
      const e = new Date(chk.rows[0]!.e)
      if (e <= s) {
        return reply.status(400).send({ error: 'Ende muss nach Start liegen' })
      }
    }

    const r = await pool.query(
      `SELECT id, internal_name, headline_de, headline_tr, headline_en,
              body_de, body_tr, body_en, image_url,
              cta_label_de, cta_label_tr, cta_label_en, cta_url,
              starts_at, ends_at, is_active, priority, show_again_after_minutes,
              impression_count, click_count, created_at, updated_at
       FROM promotion_campaigns WHERE id = $1`,
      [id],
    )
    return { campaign: mapPromotionCampaignRow(r.rows[0]!) }
  })

  app.delete('/api/admin/promotions/:id', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const r = await pool.query(`DELETE FROM promotion_campaigns WHERE id = $1 RETURNING id`, [id])
    if (!r.rowCount) return reply.status(404).send({ error: 'Kampagne nicht gefunden' })
    return { ok: true }
  })
}
