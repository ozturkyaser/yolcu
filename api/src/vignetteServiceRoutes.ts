import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { sendMailSafe, vignetteAdminNotifyEmail } from './mail.js'
import { paypalCaptureAndVerify, paypalCreateOrderForVignette, getPayPalConfig } from './paypalClient.js'
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

function mapProduct(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    countryCode: String(row.country_code),
    vehicleClass: String(row.vehicle_class),
    kind: String(row.kind),
    title: String(row.title),
    description: String(row.description),
    officialUrl: String(row.official_url),
    partnerCheckoutUrl: String(row.partner_checkout_url),
    retailHintEur: row.retail_hint_eur != null ? Number(row.retail_hint_eur) : null,
    serviceFeeEur: Number(row.service_fee_eur),
    isActive: Boolean(row.is_active),
    sortOrder: Number(row.sort_order),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const orderCreateSchema = z.object({
  vehicleClass: z.enum(['car', 'motorcycle', 'heavy', 'other']),
  countries: z
    .array(
      z.object({
        code: z.string().length(2),
        name: z.string().max(120),
      }),
    )
    .min(1)
    .max(40),
  routeLabel: z.string().max(400).optional().default(''),
  productIds: z.array(z.string().min(1).max(80)).min(1).max(30),
  customerNote: z.string().max(2000).optional().default(''),
})

const productCreateSchema = z.object({
  id: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9-]+$/),
  countryCode: z.string().length(2),
  vehicleClass: z.enum(['car', 'motorcycle', 'heavy', 'other', 'all']).optional().default('car'),
  kind: z.enum(['vignette', 'toll', 'info']).optional().default('vignette'),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional().default(''),
  officialUrl: z.string().max(800).optional().default(''),
  partnerCheckoutUrl: z.string().max(800).optional().default(''),
  retailHintEur: z.number().min(0).max(99999).nullable().optional(),
  serviceFeeEur: z.number().min(0).max(9999).optional().default(0),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.number().int().optional().default(0),
})

const productPatchSchema = productCreateSchema.omit({ id: true }).partial()

const orderPatchSchema = z.object({
  status: z.enum(['pending', 'in_review', 'quoted', 'paid', 'fulfilled', 'cancelled']).optional(),
  adminNote: z.string().max(2000).optional(),
  quotedTotalEur: z.number().min(0).max(999999).nullable().optional(),
})

export async function registerVignetteServiceRoutes(app: FastifyInstance) {
  app.get('/api/vignette-service-products', async (request, reply) => {
    const q = z.object({ countryCode: z.string().length(2).optional() }).safeParse(request.query)
    if (!q.success) return reply.status(400).send({ error: q.error.flatten() })
    const cc = q.data.countryCode?.toUpperCase()
    const r = await pool.query(
      `SELECT id, country_code, vehicle_class, kind, title, description, official_url, partner_checkout_url,
              retail_hint_eur, service_fee_eur, is_active, sort_order, created_at, updated_at
       FROM vignette_service_products
       WHERE is_active = true
         AND ($1::text IS NULL OR country_code = $1)
       ORDER BY sort_order DESC, title ASC`,
      [cc ?? null],
    )
    return { products: r.rows.map(mapProduct) }
  })

  app.post('/api/vignette-order-requests', { preHandler: authenticate }, async (request, reply) => {
    const parsed = orderCreateSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const d = parsed.data
    const uniq = [...new Set(d.productIds)]
    const pr = await pool.query(
      `SELECT id FROM vignette_service_products
       WHERE id = ANY($1::text[]) AND is_active = true`,
      [uniq],
    )
    if (pr.rowCount !== uniq.length) {
      return reply.status(400).send({ error: 'Unbekannte oder inaktive Produkt-ID in der Auswahl.' })
    }
    const ins = await pool.query(
      `INSERT INTO vignette_order_requests (
         user_id, vehicle_class, countries_json, route_label, selected_product_ids, customer_note
       ) VALUES ($1, $2, $3::jsonb, $4, $5, $6)
       RETURNING id, status, vehicle_class, countries_json, route_label, selected_product_ids, customer_note, created_at`,
      [
        request.user.sub,
        d.vehicleClass,
        JSON.stringify(d.countries),
        d.routeLabel.trim(),
        uniq,
        d.customerNote.trim(),
      ],
    )
    const row = ins.rows[0]
    const adminTo = vignetteAdminNotifyEmail()
    if (adminTo) {
      const u = await pool.query<{ email: string; display_name: string }>(
        `SELECT email, display_name FROM users WHERE id = $1`,
        [request.user.sub],
      )
      const who = u.rows[0]
      const countriesLine = Array.isArray(d.countries) ? d.countries.map((c) => c.name).join(' → ') : ''
      const text = [
        `Neue Vignetten-/Maut-Anfrage`,
        ``,
        `ID: ${row.id}`,
        `Nutzer: ${who?.display_name ?? '?'} <${who?.email ?? '?'}>`,
        `Route: ${d.routeLabel.trim() || '—'}`,
        `Länder: ${countriesLine}`,
        `Fahrzeugklasse: ${d.vehicleClass}`,
        `Produkt-IDs: ${uniq.join(', ')}`,
        d.customerNote.trim() ? `Hinweis Kunde: ${d.customerNote.trim()}` : '',
        ``,
        `Bitte im Admin-Panel unter „Vign.-Anfragen“ bearbeiten.`,
      ]
        .filter(Boolean)
        .join('\n')
      void sendMailSafe({
        to: adminTo,
        subject: `[Yol] Neue Vignetten-Anfrage ${row.id}`,
        text,
      }).catch((e) => console.error('[mail] admin vignette notify', e))
    }
    const uMail = await pool.query<{ email: string; display_name: string }>(
      `SELECT email, display_name FROM users WHERE id = $1`,
      [request.user.sub],
    )
    const cust = uMail.rows[0]
    if (cust?.email) {
      const countriesLine = Array.isArray(d.countries) ? d.countries.map((c) => c.name).join(' → ') : ''
      const base = publicWebAppBaseUrl()
      const custText = [
        `Hallo ${cust.display_name || ''},`,
        ``,
        `wir haben deine Vignetten-/Maut-Anfrage erhalten (Nr. ${row.id}).`,
        ``,
        `Route: ${d.routeLabel.trim() || '—'}`,
        `Länder: ${countriesLine}`,
        d.customerNote.trim() ? `Dein Hinweis: ${d.customerNote.trim()}` : '',
        ``,
        `Wir melden uns mit einem Angebot. Danach kannst du unter „Profil → Vignetten & Maut“ bezahlen (Stripe/PayPal, sofern konfiguriert).`,
        `${base}/profile`,
        ``,
        `Viele Grüße`,
        `Dein Yol-Team`,
      ]
        .filter(Boolean)
        .join('\n')
      void sendMailSafe({
        to: cust.email,
        subject: `[Yol] Vignetten-Anfrage eingegangen`,
        text: custText,
      }).catch((e) => console.error('[mail] customer vignette request confirm', e))
    }
    return {
      request: {
        id: row.id,
        status: row.status,
        vehicleClass: row.vehicle_class,
        countries: row.countries_json,
        routeLabel: row.route_label,
        productIds: row.selected_product_ids,
        customerNote: row.customer_note,
        createdAt: row.created_at,
      },
    }
  })

  app.get('/api/my/vignette-order-requests', { preHandler: authenticate }, async (request) => {
    const r = await pool.query(
      `SELECT id, status, route_label, quoted_total_eur, created_at, paid_at, stripe_checkout_session_id
       FROM vignette_order_requests
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [request.user.sub],
    )
    const stripeOn = Boolean(getStripe())
    const paypalOn = Boolean(getPayPalConfig())
    return {
      requests: r.rows.map((row) => {
        const quoted = row.quoted_total_eur != null ? Number(row.quoted_total_eur) : null
        const payable =
          row.status === 'quoted' && quoted != null && Number.isFinite(quoted) && quoted > 0
        const canPayStripe = payable && stripeOn
        const canPayPaypal = payable && paypalOn
        return {
          id: row.id,
          status: row.status,
          routeLabel: row.route_label,
          quotedTotalEur: quoted,
          createdAt: row.created_at,
          paidAt: row.paid_at,
          canPayStripe,
          canPayPaypal,
        }
      }),
    }
  })

  const confirmCheckoutSchema = z.object({
    sessionId: z.string().min(10).max(200),
  })

  app.post('/api/vignette-order-requests/confirm-checkout', { preHandler: authenticate }, async (request, reply) => {
    const parsed = confirmCheckoutSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const stripe = getStripe()
    if (!stripe) return reply.status(503).send({ error: 'Zahlungen nicht konfiguriert.' })
    const session = await stripe.checkout.sessions.retrieve(parsed.data.sessionId)
    if (session.payment_status !== 'paid') {
      return reply.status(400).send({ error: 'Zahlung noch nicht abgeschlossen.' })
    }
    const orderId = session.metadata?.vignetteOrderId
    if (!orderId || !z.string().uuid().safeParse(orderId).success) {
      return reply.status(400).send({ error: 'Ungültige Stripe-Sitzung.' })
    }
    if (session.metadata?.userId !== request.user.sub) {
      return reply.status(403).send({ error: 'Sitzung gehört nicht zu diesem Konto.' })
    }
    const ord = await pool.query<{ user_id: string; status: string }>(
      `SELECT user_id, status FROM vignette_order_requests WHERE id = $1::uuid`,
      [orderId],
    )
    if (!ord.rowCount) return reply.status(404).send({ error: 'Bestellung nicht gefunden' })
    if (ord.rows[0].user_id !== request.user.sub) return reply.status(403).send({ error: 'Kein Zugriff' })
    if (ord.rows[0].status === 'paid') {
      return { ok: true, status: 'paid', alreadyConfirmed: true }
    }
    if (ord.rows[0].status !== 'quoted') {
      return reply.status(400).send({ error: 'Bestellung ist nicht mehr zahlbar (Status).' })
    }
    await pool.query(
      `UPDATE vignette_order_requests
       SET status = 'paid', paid_at = now(), stripe_checkout_session_id = $2, updated_at = now()
       WHERE id = $1::uuid`,
      [orderId, parsed.data.sessionId],
    )
    return { ok: true, status: 'paid' }
  })

  app.post('/api/vignette-order-requests/:orderId/stripe-checkout', { preHandler: authenticate }, async (request, reply) => {
    const orderId = z.string().uuid().safeParse((request.params as { orderId: string }).orderId)
    if (!orderId.success) return reply.status(400).send({ error: 'Ungültige Bestell-ID' })
    const stripe = getStripe()
    if (!stripe) {
      return reply.status(503).send({ error: 'Zahlungen nicht konfiguriert (STRIPE_SECRET_KEY).' })
    }
    const ord = await pool.query<{
      user_id: string
      status: string
      quoted_total_eur: string | null
      route_label: string
    }>(
      `SELECT user_id, status, quoted_total_eur::text, route_label
       FROM vignette_order_requests WHERE id = $1::uuid`,
      [orderId.data],
    )
    if (!ord.rowCount) return reply.status(404).send({ error: 'Nicht gefunden' })
    if (ord.rows[0].user_id !== request.user.sub) return reply.status(403).send({ error: 'Kein Zugriff' })
    if (ord.rows[0].status !== 'quoted') {
      return reply.status(400).send({ error: 'Nur Angebote im Status „quoted“ sind zahlbar.' })
    }
    const amount = ord.rows[0].quoted_total_eur != null ? Number(ord.rows[0].quoted_total_eur) : NaN
    if (!Number.isFinite(amount) || amount <= 0) {
      return reply.status(400).send({ error: 'Kein gültiger Angebotspreis hinterlegt.' })
    }
    const base = publicWebAppBaseUrl()
    const label = (ord.rows[0].route_label || 'Vignetten-Service').slice(0, 120)
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'eur',
            unit_amount: Math.round(amount * 100),
            product_data: {
              name: `Vignetten-Service: ${label}`,
            },
          },
        },
      ],
      metadata: { vignetteOrderId: orderId.data, userId: request.user.sub },
      success_url: `${base}/profile?vignetteCheckout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/profile?vignetteCheckout=cancel`,
    })
    await pool.query(
      `UPDATE vignette_order_requests SET stripe_checkout_session_id = $2, updated_at = now() WHERE id = $1::uuid`,
      [orderId.data, session.id],
    )
    return { url: session.url }
  })

  app.post('/api/vignette-order-requests/:orderId/paypal-checkout', { preHandler: authenticate }, async (request, reply) => {
    const orderId = z.string().uuid().safeParse((request.params as { orderId: string }).orderId)
    if (!orderId.success) return reply.status(400).send({ error: 'Ungültige Bestell-ID' })
    if (!getPayPalConfig()) {
      return reply.status(503).send({ error: 'PayPal nicht konfiguriert (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET).' })
    }
    const ord = await pool.query<{
      user_id: string
      status: string
      quoted_total_eur: string | null
      route_label: string
    }>(
      `SELECT user_id, status, quoted_total_eur::text, route_label
       FROM vignette_order_requests WHERE id = $1::uuid`,
      [orderId.data],
    )
    if (!ord.rowCount) return reply.status(404).send({ error: 'Nicht gefunden' })
    if (ord.rows[0].user_id !== request.user.sub) return reply.status(403).send({ error: 'Kein Zugriff' })
    if (ord.rows[0].status !== 'quoted') {
      return reply.status(400).send({ error: 'Nur Angebote im Status „quoted“ sind zahlbar.' })
    }
    const amount = ord.rows[0].quoted_total_eur != null ? Number(ord.rows[0].quoted_total_eur) : NaN
    if (!Number.isFinite(amount) || amount <= 0) {
      return reply.status(400).send({ error: 'Kein gültiger Angebotspreis hinterlegt.' })
    }
    const base = publicWebAppBaseUrl()
    const label = (ord.rows[0].route_label || 'Vignetten-Service').slice(0, 120)
    const created = await paypalCreateOrderForVignette({
      amountEur: amount,
      vignetteOrderId: orderId.data,
      description: `Vignetten-Service: ${label}`,
      returnUrl: `${base}/profile?vignetteCheckout=paypal_success`,
      cancelUrl: `${base}/profile?vignetteCheckout=paypal_cancel`,
    })
    if (!created) {
      return reply.status(502).send({ error: 'PayPal-Checkout konnte nicht erstellt werden.' })
    }
    await pool.query(
      `UPDATE vignette_order_requests SET paypal_order_id = $2, updated_at = now() WHERE id = $1::uuid`,
      [orderId.data, created.paypalOrderId],
    )
    return { url: created.approveUrl }
  })

  const confirmPaypalSchema = z.object({
    paypalOrderId: z.string().min(5).max(200),
  })

  app.post('/api/vignette-order-requests/confirm-paypal', { preHandler: authenticate }, async (request, reply) => {
    const parsed = confirmPaypalSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const paypalOrderId = parsed.data.paypalOrderId
    const ord = await pool.query<{
      id: string
      user_id: string
      status: string
      quoted_total_eur: string | null
      paypal_order_id: string | null
    }>(
      `SELECT id, user_id, status, quoted_total_eur::text, paypal_order_id
       FROM vignette_order_requests
       WHERE user_id = $1 AND paypal_order_id = $2`,
      [request.user.sub, paypalOrderId],
    )
    if (!ord.rowCount) return reply.status(404).send({ error: 'Bestellung nicht gefunden' })
    const row = ord.rows[0]!
    if (row.paypal_order_id !== paypalOrderId) {
      return reply.status(400).send({ error: 'PayPal-Zuordnung ungültig.' })
    }
    const amount = row.quoted_total_eur != null ? Number(row.quoted_total_eur) : NaN
    if (!Number.isFinite(amount) || amount <= 0) {
      return reply.status(400).send({ error: 'Kein gültiger Angebotspreis.' })
    }
    if (row.status === 'paid') {
      return { ok: true, status: 'paid', alreadyConfirmed: true }
    }
    if (row.status !== 'quoted') {
      return reply.status(400).send({ error: 'Bestellung ist nicht mehr zahlbar (Status).' })
    }
    const cap = await paypalCaptureAndVerify({
      paypalOrderId,
      expectedVignetteOrderId: row.id,
      expectedAmountEur: amount,
    })
    if (!cap.ok) {
      return reply.status(400).send({ error: cap.reason })
    }
    await pool.query(
      `UPDATE vignette_order_requests
       SET status = 'paid', paid_at = now(), updated_at = now()
       WHERE id = $1::uuid AND status = 'quoted'`,
      [row.id],
    )
    return { ok: true, status: 'paid' }
  })

  app.get('/api/admin/vignette-service-products', { preHandler: [authenticate, requireAdmin] }, async () => {
    const r = await pool.query(
      `SELECT id, country_code, vehicle_class, kind, title, description, official_url, partner_checkout_url,
              retail_hint_eur, service_fee_eur, is_active, sort_order, created_at, updated_at
       FROM vignette_service_products
       ORDER BY sort_order DESC, country_code, title`,
    )
    return { products: r.rows.map(mapProduct) }
  })

  app.post('/api/admin/vignette-service-products', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const parsed = productCreateSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const p = parsed.data
    try {
      await pool.query(
        `INSERT INTO vignette_service_products (
           id, country_code, vehicle_class, kind, title, description, official_url, partner_checkout_url,
           retail_hint_eur, service_fee_eur, is_active, sort_order
         ) VALUES ($1, upper($2), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          p.id,
          p.countryCode,
          p.vehicleClass,
          p.kind,
          p.title.trim(),
          p.description.trim(),
          p.officialUrl.trim(),
          p.partnerCheckoutUrl.trim(),
          p.retailHintEur ?? null,
          p.serviceFeeEur,
          p.isActive,
          p.sortOrder,
        ],
      )
    } catch (e) {
      const err = e as { code?: string }
      if (err.code === '23505') return reply.status(409).send({ error: 'ID bereits vergeben' })
      throw e
    }
    const r = await pool.query(
      `SELECT id, country_code, vehicle_class, kind, title, description, official_url, partner_checkout_url,
              retail_hint_eur, service_fee_eur, is_active, sort_order, created_at, updated_at
       FROM vignette_service_products WHERE id = $1`,
      [p.id],
    )
    return { product: mapProduct(r.rows[0]!) }
  })

  app.patch('/api/admin/vignette-service-products/:id', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const parsed = productPatchSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const p = parsed.data
    const parts: string[] = []
    const vals: unknown[] = []
    let n = 1
    const add = (col: string, val: unknown) => {
      parts.push(`${col} = $${n}`)
      vals.push(val)
      n += 1
    }
    if (p.countryCode != null) add('country_code', p.countryCode.toUpperCase())
    if (p.vehicleClass != null) add('vehicle_class', p.vehicleClass)
    if (p.kind != null) add('kind', p.kind)
    if (p.title != null) add('title', p.title.trim())
    if (p.description != null) add('description', p.description.trim())
    if (p.officialUrl != null) add('official_url', p.officialUrl.trim())
    if (p.partnerCheckoutUrl != null) add('partner_checkout_url', p.partnerCheckoutUrl.trim())
    if (p.retailHintEur !== undefined) add('retail_hint_eur', p.retailHintEur)
    if (p.serviceFeeEur != null) add('service_fee_eur', p.serviceFeeEur)
    if (p.isActive != null) add('is_active', p.isActive)
    if (p.sortOrder != null) add('sort_order', p.sortOrder)
    if (parts.length === 0) return reply.status(400).send({ error: 'Keine Felder' })
    parts.push('updated_at = now()')
    vals.push(id)
    const u = await pool.query(
      `UPDATE vignette_service_products SET ${parts.join(', ')} WHERE id = $${n} RETURNING id`,
      vals,
    )
    if (!u.rowCount) return reply.status(404).send({ error: 'Nicht gefunden' })
    const r = await pool.query(
      `SELECT id, country_code, vehicle_class, kind, title, description, official_url, partner_checkout_url,
              retail_hint_eur, service_fee_eur, is_active, sort_order, created_at, updated_at
       FROM vignette_service_products WHERE id = $1`,
      [id],
    )
    return { product: mapProduct(r.rows[0]!) }
  })

  app.delete('/api/admin/vignette-service-products/:id', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const r = await pool.query(`DELETE FROM vignette_service_products WHERE id = $1 RETURNING id`, [id])
    if (!r.rowCount) return reply.status(404).send({ error: 'Nicht gefunden' })
    return { ok: true }
  })

  app.get('/api/admin/vignette-order-requests', { preHandler: [authenticate, requireAdmin] }, async () => {
    const r = await pool.query(
      `SELECT o.id, o.status, o.vehicle_class, o.countries_json, o.route_label, o.selected_product_ids,
              o.customer_note, o.admin_note, o.quoted_total_eur, o.created_at, o.updated_at,
              o.paid_at, o.stripe_checkout_session_id,
              u.email AS user_email, u.display_name AS user_display_name
       FROM vignette_order_requests o
       JOIN users u ON u.id = o.user_id
       ORDER BY o.created_at DESC
       LIMIT 200`,
    )
    return {
      requests: r.rows.map((row) => ({
        id: row.id,
        status: row.status,
        vehicleClass: row.vehicle_class,
        countries: row.countries_json,
        routeLabel: row.route_label,
        productIds: row.selected_product_ids,
        customerNote: row.customer_note,
        adminNote: row.admin_note,
        quotedTotalEur: row.quoted_total_eur != null ? Number(row.quoted_total_eur) : null,
        paidAt: row.paid_at,
        stripeCheckoutSessionId: row.stripe_checkout_session_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        userEmail: row.user_email,
        userDisplayName: row.user_display_name,
      })),
    }
  })

  app.patch('/api/admin/vignette-order-requests/:id', { preHandler: [authenticate, requireAdmin] }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const uuidOk = z.string().uuid().safeParse(id)
    if (!uuidOk.success) return reply.status(400).send({ error: 'Ungültige Anfrage-ID' })
    const parsed = orderPatchSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const d = parsed.data
    const prev = await pool.query<{
      status: string
      route_label: string
      user_email: string
      display_name: string
      quoted_total_eur: string | null
    }>(
      `SELECT o.status, o.route_label, u.email AS user_email, u.display_name, o.quoted_total_eur::text
       FROM vignette_order_requests o
       JOIN users u ON u.id = o.user_id
       WHERE o.id = $1::uuid`,
      [id],
    )
    if (!prev.rowCount) return reply.status(404).send({ error: 'Nicht gefunden' })
    const prevRow = prev.rows[0]!
    const parts: string[] = []
    const vals: unknown[] = []
    let n = 1
    const add = (col: string, val: unknown) => {
      parts.push(`${col} = $${n}`)
      vals.push(val)
      n += 1
    }
    if (d.status != null) add('status', d.status)
    if (d.adminNote !== undefined) add('admin_note', d.adminNote.trim())
    if (d.quotedTotalEur !== undefined) add('quoted_total_eur', d.quotedTotalEur)
    if (parts.length === 0) return reply.status(400).send({ error: 'Keine Felder' })
    parts.push('updated_at = now()')
    vals.push(id)
    const u = await pool.query(
      `UPDATE vignette_order_requests SET ${parts.join(', ')} WHERE id = $${n}::uuid RETURNING id, status, quoted_total_eur`,
      vals,
    )
    if (!u.rowCount) return reply.status(404).send({ error: 'Nicht gefunden' })
    const newStatus = String(u.rows[0].status)
    const newQuoted =
      u.rows[0].quoted_total_eur != null ? Number(u.rows[0].quoted_total_eur) : null
    const becameQuoted =
      newStatus === 'quoted' &&
      prevRow.status !== 'quoted' &&
      newQuoted != null &&
      Number.isFinite(newQuoted) &&
      newQuoted > 0
    if (becameQuoted && prevRow.user_email) {
      const base = publicWebAppBaseUrl()
      const text = [
        `Hallo ${prevRow.display_name || ''},`,
        ``,
        `zu deiner Vignetten-/Maut-Anfrage liegt ein Angebot vor.`,
        ``,
        `Route / Titel: ${prevRow.route_label || '—'}`,
        `Angebotssumme: ${newQuoted.toFixed(2)} € (inkl. Gebühren nach Abstimmung)`,
        ``,
        `Zahlung unter Profil (Stripe und/oder PayPal, je nach Einrichtung): ${base}/profile`,
        ``,
        `Viele Grüße`,
        `Dein Yol-Team`,
      ].join('\n')
      void sendMailSafe({
        to: prevRow.user_email,
        subject: `[Yol] Angebot zu deiner Vignetten-Anfrage`,
        text,
      }).catch((e) => console.error('[mail] customer quoted notify', e))
    }
    return { ok: true }
  })
}
