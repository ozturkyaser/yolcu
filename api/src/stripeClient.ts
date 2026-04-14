import Stripe from 'stripe'

let cached: Stripe | null | undefined

export function getStripe(): Stripe | null {
  if (cached !== undefined) return cached
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  if (!key) {
    cached = null
    return null
  }
  cached = new Stripe(key)
  return cached
}

export function publicWebAppBaseUrl(): string {
  const raw = process.env.PUBLIC_WEB_APP_URL?.trim() || 'http://localhost:5173'
  return raw.replace(/\/$/, '')
}
