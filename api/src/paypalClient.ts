/** PayPal Orders v2 (REST) – optional, parallel zu Stripe. */

type PayPalConfig = { clientId: string; secret: string; apiBase: string }

let accessTokenCache: { token: string; expiresAtMs: number } | null = null

export function getPayPalConfig(): PayPalConfig | null {
  const clientId = process.env.PAYPAL_CLIENT_ID?.trim()
  const secret = process.env.PAYPAL_CLIENT_SECRET?.trim()
  if (!clientId || !secret) return null
  const live = process.env.PAYPAL_MODE === 'live'
  const apiBase = live ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com'
  return { clientId, secret, apiBase }
}

async function paypalAccessToken(cfg: PayPalConfig): Promise<string | null> {
  const now = Date.now()
  if (accessTokenCache && now < accessTokenCache.expiresAtMs - 30_000) {
    return accessTokenCache.token
  }
  const auth = Buffer.from(`${cfg.clientId}:${cfg.secret}`).toString('base64')
  const res = await fetch(`${cfg.apiBase}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  if (!res.ok) {
    accessTokenCache = null
    return null
  }
  const j = (await res.json()) as { access_token?: string; expires_in?: number }
  if (typeof j.access_token !== 'string') return null
  const ttlSec = typeof j.expires_in === 'number' ? j.expires_in : 300
  accessTokenCache = { token: j.access_token, expiresAtMs: now + ttlSec * 1000 }
  return j.access_token
}

function formatEur(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0.00'
  return value.toFixed(2)
}

export async function paypalCreateOrderForVignette(opts: {
  amountEur: number
  vignetteOrderId: string
  description: string
  returnUrl: string
  cancelUrl: string
}): Promise<{ paypalOrderId: string; approveUrl: string } | null> {
  const cfg = getPayPalConfig()
  if (!cfg) return null
  const access = await paypalAccessToken(cfg)
  if (!access) return null
  const value = formatEur(opts.amountEur)
  const res = await fetch(`${cfg.apiBase}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: 'vignette',
          custom_id: opts.vignetteOrderId,
          description: opts.description.slice(0, 127),
          amount: { currency_code: 'EUR', value },
        },
      ],
      application_context: {
        brand_name: 'Yol Arkadasim',
        landing_page: 'NO_PREFERENCE',
        user_action: 'PAY_NOW',
        return_url: opts.returnUrl,
        cancel_url: opts.cancelUrl,
      },
    }),
  })
  if (!res.ok) return null
  const data = (await res.json()) as {
    id?: string
    links?: Array<{ href: string; rel: string; method?: string }>
  }
  const paypalOrderId = data.id
  if (typeof paypalOrderId !== 'string') return null
  const approve = data.links?.find((l) => l.rel === 'approve' && l.href)
  if (!approve?.href) return null
  return { paypalOrderId, approveUrl: approve.href }
}

export async function paypalCaptureAndVerify(opts: {
  paypalOrderId: string
  expectedVignetteOrderId: string
  expectedAmountEur: number
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const cfg = getPayPalConfig()
  if (!cfg) return { ok: false, reason: 'PayPal nicht konfiguriert.' }
  const access = await paypalAccessToken(cfg)
  if (!access) return { ok: false, reason: 'PayPal-Token fehlgeschlagen.' }

  const getRes = await fetch(`${cfg.apiBase}/v2/checkout/orders/${encodeURIComponent(opts.paypalOrderId)}`, {
    headers: { Authorization: `Bearer ${access}` },
  })
  if (!getRes.ok) return { ok: false, reason: 'PayPal-Bestellung nicht gefunden.' }
  const order = (await getRes.json()) as {
    status?: string
    purchase_units?: Array<{
      custom_id?: string
      amount?: { currency_code?: string; value?: string }
    }>
  }
  const unit = order.purchase_units?.[0]
  const customId = unit?.custom_id
  if (customId !== opts.expectedVignetteOrderId) {
    return { ok: false, reason: 'Bestellzuordnung ungültig.' }
  }
  const val = unit?.amount?.value != null ? Number.parseFloat(String(unit.amount.value)) : NaN
  if (!Number.isFinite(val) || Math.abs(val - opts.expectedAmountEur) > 0.02) {
    return { ok: false, reason: 'Betrag stimmt nicht mit Angebot überein.' }
  }
  if (order.status === 'COMPLETED') {
    return { ok: true }
  }
  if (order.status !== 'APPROVED') {
    return { ok: false, reason: `PayPal-Status: ${order.status ?? 'unbekannt'}` }
  }

  const capRes = await fetch(
    `${cfg.apiBase}/v2/checkout/orders/${encodeURIComponent(opts.paypalOrderId)}/capture`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access}`,
        'Content-Type': 'application/json',
      },
    },
  )
  if (!capRes.ok) return { ok: false, reason: 'Einzug bei PayPal fehlgeschlagen.' }
  const cap = (await capRes.json()) as { status?: string }
  if (cap.status !== 'COMPLETED') {
    return { ok: false, reason: `Zahlung nicht abgeschlossen (${cap.status ?? '?'})` }
  }
  return { ok: true }
}
