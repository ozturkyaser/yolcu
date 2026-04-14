import { useEffect, useState } from 'react'
import { fetchAdminPaymentSettings, type AdminPaymentSettingsDto } from '../lib/api'
import { useAuth } from '../context/AuthContext'

function pill(ok: boolean) {
  return ok
    ? 'bg-tertiary-container text-on-tertiary-container'
    : 'bg-surface-container-high text-on-surface-variant'
}

export function AdminPaymentSettingsPage() {
  const { token } = useAuth()
  const [data, setData] = useState<AdminPaymentSettingsDto | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    void (async () => {
      setErr(null)
      try {
        const d = await fetchAdminPaymentSettings(token)
        if (!cancelled) setData(d)
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Laden fehlgeschlagen')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-black text-on-surface">Zahlungen & PayPal</h1>
        <p className="mt-1 text-sm text-on-surface-variant">
          Serverseitige Konfiguration (ohne Geheimnisse). Werte kommen aus der laufenden API-Umgebung; Änderungen nur
          per Deployment / <code className="rounded bg-surface-container-high px-1">docker-compose</code> / Secrets.
        </p>
      </header>
      {err ? <p className="rounded-xl bg-error-container px-3 py-2 text-sm text-on-error-container">{err}</p> : null}
      {!data && !err ? <p className="text-sm text-on-surface-variant">Laden…</p> : null}
      {data ? (
        <>
          <section className="rounded-2xl border border-outline-variant/50 bg-surface-container-low p-4">
            <h2 className="text-sm font-black text-on-surface">Öffentliche App-URL</h2>
            <p className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-bold ${pill(true)}`}>
              PUBLIC_WEB_APP_URL
            </p>
            <p className="mt-2 break-all font-mono text-sm text-on-surface">{data.publicWebAppUrl}</p>
            <p className="mt-2 text-xs text-on-surface-variant">
              Wird für Stripe- und PayPal-Rückleitungen nach dem Checkout verwendet.
            </p>
          </section>

          <section className="rounded-2xl border border-outline-variant/50 bg-surface-container-low p-4">
            <h2 className="text-sm font-black text-on-surface">Stripe</h2>
            <p className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-bold ${pill(data.stripe.configured)}`}>
              {data.stripe.configured ? 'STRIPE_SECRET_KEY gesetzt' : 'nicht konfiguriert'}
            </p>
            {data.stripe.configured ? (
              <p className="mt-2 text-sm text-on-surface">
                Schlüssel-Typ:{' '}
                <strong>
                  {data.stripe.keyKind === 'test'
                    ? 'Test (sk_test_…)'
                    : data.stripe.keyKind === 'live'
                      ? 'Live (sk_live_…)'
                      : data.stripe.keyKind === 'custom'
                        ? 'Unbekanntes Präfix'
                        : '—'}
                </strong>
              </p>
            ) : null}
          </section>

          <section className="rounded-2xl border border-outline-variant/50 bg-surface-container-low p-4">
            <h2 className="text-sm font-black text-on-surface">PayPal</h2>
            <p className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-bold ${pill(data.paypal.configured)}`}>
              {data.paypal.configured ? 'REST API aktiv' : 'nicht konfiguriert'}
            </p>
            {data.paypal.configured ? (
              <ul className="mt-3 space-y-1.5 text-sm text-on-surface">
                <li>
                  Modus: <strong>{data.paypal.mode === 'live' ? 'Live' : 'Sandbox'}</strong> (PAYPAL_MODE)
                </li>
                <li>
                  Client-ID (Vorschau): <span className="font-mono text-xs">{data.paypal.clientIdPreview}</span>
                </li>
                <li>
                  API-Basis: <span className="break-all font-mono text-xs">{data.paypal.apiBase}</span>
                </li>
              </ul>
            ) : (
              <p className="mt-2 text-xs text-on-surface-variant">
                Setze PAYPAL_CLIENT_ID und PAYPAL_CLIENT_SECRET. Optional PAYPAL_MODE=sandbox|live.
              </p>
            )}
          </section>

          <section className="rounded-2xl border border-outline-variant/50 bg-surface-container-low p-4">
            <h2 className="text-sm font-black text-on-surface">Vignetten-Checkout (Redirect-URLs)</h2>
            <p className="mt-2 text-xs text-on-surface-variant">
              Diese Pfade müssen in Stripe/PayPal-Dashboards erlaubt sein, falls dort Return-URLs eingeschränkt sind.
            </p>
            <dl className="mt-3 space-y-2 text-xs">
              <div>
                <dt className="font-bold text-on-surface-variant">Stripe Erfolg</dt>
                <dd className="break-all font-mono text-on-surface">{data.vignetteCheckoutUrls.stripeSuccess}</dd>
              </div>
              <div>
                <dt className="font-bold text-on-surface-variant">Stripe Abbruch</dt>
                <dd className="break-all font-mono text-on-surface">{data.vignetteCheckoutUrls.stripeCancel}</dd>
              </div>
              <div>
                <dt className="font-bold text-on-surface-variant">PayPal Rückkehr</dt>
                <dd className="break-all font-mono text-on-surface">{data.vignetteCheckoutUrls.paypalReturn}</dd>
              </div>
              <div>
                <dt className="font-bold text-on-surface-variant">PayPal Abbruch</dt>
                <dd className="break-all font-mono text-on-surface">{data.vignetteCheckoutUrls.paypalCancel}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-2xl border border-outline-variant/50 bg-surface-container-low p-4">
            <h2 className="text-sm font-black text-on-surface">E-Mail (Admin-Benachrichtigung)</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${pill(data.mail.smtpConfigured)}`}>
                SMTP {data.mail.smtpConfigured ? 'konfiguriert' : 'fehlt'}
              </span>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${pill(data.mail.vignetteAdminEmailSet)}`}>
                Vignette-Admin-Mail {data.mail.vignetteAdminEmailSet ? 'gesetzt' : 'fehlt'}
              </span>
            </div>
            {data.mail.vignetteAdminEmailHint ? (
              <p className="mt-2 font-mono text-xs text-on-surface">Empfänger: {data.mail.vignetteAdminEmailHint}</p>
            ) : null}
            <p className="mt-2 text-xs text-on-surface-variant">
              Variablen: {data.envVarsDoc.mail.join(', ')} (alternativ MAIL_ADMIN_NOTIFY statt VIGNETTE_ADMIN_EMAIL).
            </p>
          </section>

          <section className="rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-4">
            <h2 className="text-sm font-black text-on-surface">Umgebungsvariablen (Referenz)</h2>
            <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-on-surface-variant">
              <li>Stripe: {data.envVarsDoc.stripe.join(', ')}</li>
              <li>PayPal: {data.envVarsDoc.paypal.join(', ')}</li>
              <li>App: {data.envVarsDoc.appUrl.join(', ')}</li>
            </ul>
          </section>
        </>
      ) : null}
    </div>
  )
}
