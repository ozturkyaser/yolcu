import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  apiFetch,
  confirmVignettePaypalCheckout,
  confirmVignetteStripeCheckout,
  createVignettePaypalCheckoutSession,
  createVignetteStripeCheckoutSession,
  fetchMyVignetteOrderRequests,
  type MyVignetteOrderDto,
  type TollVehicleClass,
  type VehicleDto,
} from '../lib/api'
import { MAP_MAP_ICON_OPTIONS, normalizeMapIconId, type MapMapIconId } from '../lib/mapIcons'
import { useAuth } from '../context/AuthContext'

export function ProfilePage() {
  const { token, user, loading: authLoading, logout, refreshMe } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [vehicles, setVehicles] = useState<VehicleDto[]>([])
  const [displayName, setDisplayName] = useState('')
  const [mapIcon, setMapIcon] = useState<MapMapIconId>('person')
  const [tollVehicleClass, setTollVehicleClass] = useState<TollVehicleClass>('car')
  const [vLabel, setVLabel] = useState('')
  const [vPlate, setVPlate] = useState('')
  const [vTrailer, setVTrailer] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [vignetteOrders, setVignetteOrders] = useState<MyVignetteOrderDto[]>([])
  const [vignetteLoading, setVignetteLoading] = useState(false)
  const [vignettePayBusy, setVignettePayBusy] = useState<string | null>(null)

  const searchQuery = useMemo(() => searchParams.toString(), [searchParams])

  useEffect(() => {
    if (!token) {
      setLoading(false)
      return
    }
    void (async () => {
      try {
        const data = await apiFetch<{ user: typeof user; vehicles: VehicleDto[] }>('/profile', { token })
        if (data.user) {
          setDisplayName(data.user.displayName)
          setMapIcon(normalizeMapIconId(data.user.mapIcon))
          setTollVehicleClass(data.user.tollVehicleClass ?? 'car')
        }
        setVehicles(data.vehicles)
        const primary = data.vehicles.find((x) => x.is_primary) ?? data.vehicles[0]
        if (primary) {
          setVLabel(primary.label)
          setVPlate(primary.plate)
          setVTrailer(primary.trailer_mode)
        }
      } catch {
        setMsg('Profil konnte nicht geladen werden.')
      } finally {
        setLoading(false)
      }
    })()
  }, [token])

  useEffect(() => {
    if (!token) {
      setVignetteOrders([])
      return
    }
    void (async () => {
      setVignetteLoading(true)
      try {
        const { requests } = await fetchMyVignetteOrderRequests(token)
        setVignetteOrders(requests)
      } catch {
        /* still show profile */
      } finally {
        setVignetteLoading(false)
      }
    })()
  }, [token])

  useEffect(() => {
    const params = new URLSearchParams(searchQuery)
    const checkout = params.get('vignetteCheckout')
    const sessionId = params.get('session_id')
    if (!token || checkout !== 'success' || !sessionId) return
    let cancelled = false
    void (async () => {
      setMsg(null)
      try {
        await confirmVignetteStripeCheckout(token, sessionId)
        if (!cancelled) {
          setMsg('Zahlung bestätigt – vielen Dank!')
          const { requests } = await fetchMyVignetteOrderRequests(token)
          setVignetteOrders(requests)
        }
      } catch (e) {
        if (!cancelled) setMsg(e instanceof Error ? e.message : 'Zahlungsbestätigung fehlgeschlagen.')
      } finally {
        if (!cancelled) {
          const next = new URLSearchParams(searchQuery)
          next.delete('vignetteCheckout')
          next.delete('session_id')
          setSearchParams(next, { replace: true })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token, searchQuery, setSearchParams])

  useEffect(() => {
    const params = new URLSearchParams(searchQuery)
    const checkout = params.get('vignetteCheckout')
    const paypalOrderId = params.get('token')
    if (!token || checkout !== 'paypal_success' || !paypalOrderId) return
    let cancelled = false
    void (async () => {
      setMsg(null)
      try {
        await confirmVignettePaypalCheckout(token, paypalOrderId)
        if (!cancelled) {
          setMsg('PayPal-Zahlung bestätigt – vielen Dank!')
          const { requests } = await fetchMyVignetteOrderRequests(token)
          setVignetteOrders(requests)
        }
      } catch (e) {
        if (!cancelled) setMsg(e instanceof Error ? e.message : 'PayPal-Bestätigung fehlgeschlagen.')
      } finally {
        if (!cancelled) {
          const next = new URLSearchParams(searchQuery)
          next.delete('vignetteCheckout')
          next.delete('token')
          next.delete('PayerID')
          setSearchParams(next, { replace: true })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token, searchQuery, setSearchParams])

  useEffect(() => {
    const params = new URLSearchParams(searchQuery)
    const v = params.get('vignetteCheckout')
    if (v !== 'cancel' && v !== 'paypal_cancel') return
    setMsg(v === 'paypal_cancel' ? 'PayPal abgebrochen.' : 'Zahlung abgebrochen.')
    params.delete('vignetteCheckout')
    params.delete('token')
    params.delete('PayerID')
    setSearchParams(params, { replace: true })
  }, [searchQuery, setSearchParams])

  if (authLoading || (token && loading)) {
    return (
      <main className="flex min-h-[40dvh] items-center justify-center text-on-surface-variant">Laden…</main>
    )
  }

  if (!token || !user) {
    return (
      <main className="mx-auto max-w-md px-6 py-16 text-center">
        <p className="mb-6 text-on-surface-variant">Bitte anmelden, um dein Profil zu sehen.</p>
        <Link
          to="/login"
          className="inline-block rounded-xl bg-primary px-8 py-3 font-bold text-on-primary"
        >
          Anmelden
        </Link>
      </main>
    )
  }

  async function saveProfile() {
    if (!token) return
    setSaving(true)
    setMsg(null)
    try {
      const nameForApi = displayName.trim() || user.displayName
      await apiFetch('/profile', {
        method: 'PUT',
        token,
        body: JSON.stringify({ displayName: nameForApi, mapIcon, tollVehicleClass }),
      })
      const vid = vehicles.find((x) => x.is_primary)?.id ?? vehicles[0]?.id
      if (vid) {
        await apiFetch(`/vehicles/${vid}`, {
          method: 'PUT',
          token,
          body: JSON.stringify({ label: vLabel, plate: vPlate, trailerMode: vTrailer }),
        })
      } else if (vLabel || vPlate) {
        const r = await apiFetch<{ vehicle: VehicleDto }>('/vehicles', {
          method: 'POST',
          token,
          body: JSON.stringify({ label: vLabel, plate: vPlate, trailerMode: vTrailer }),
        })
        setVehicles([r.vehicle])
      }
      setMsg('Gespeichert.')
      await refreshMe()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Fehler')
    } finally {
      setSaving(false)
    }
  }

  const primary = vehicles.find((x) => x.is_primary) ?? vehicles[0]

  return (
    <main className="mx-auto max-w-4xl px-6 pb-28 pt-2">
      {msg ? (
        <div className="mb-4 rounded-xl bg-surface-container-low p-3 text-sm font-medium text-on-surface">{msg}</div>
      ) : null}

      <section className="mb-12 grid grid-cols-1 gap-6 md:grid-cols-12">
        <div className="flex flex-col items-center md:col-span-4 md:items-start">
          <div className="mb-4 flex h-32 w-32 items-center justify-center overflow-hidden rounded-full bg-primary-container text-4xl font-black text-on-primary ring-4 ring-primary-container shadow-2xl">
            {user.displayName.slice(0, 1).toUpperCase()}
          </div>
          <h2 className="font-sans text-2xl font-extrabold tracking-tight">{user.displayName}</h2>
          <p className="font-sans text-xs uppercase tracking-widest text-on-surface-variant">{user.email}</p>
          {user.role === 'admin' ? (
            <Link
              to="/admin"
              className="mt-3 inline-flex items-center justify-center rounded-xl bg-inverse-surface px-4 py-2 text-xs font-black uppercase tracking-wide text-inverse-on-surface"
            >
              Admin-Panel
            </Link>
          ) : null}
          <button
            type="button"
            onClick={logout}
            className="mt-4 text-sm font-bold text-error"
          >
            Abmelden
          </button>
        </div>
        <div className="grid grid-cols-2 gap-4 md:col-span-8">
          <div className="flex flex-col justify-center rounded-xl bg-surface-container-low p-6">
            <span className="mb-1 font-sans text-[0.75rem] font-medium uppercase tracking-wide text-on-surface-variant">
              Toplam Mesafe
            </span>
            <span className="font-sans text-4xl font-bold text-primary">
              {user.statsKm.toLocaleString('de-DE')}
              <span className="ml-1 text-xl font-medium">km</span>
            </span>
          </div>
          <div className="flex flex-col justify-center rounded-xl bg-surface-container-low p-6">
            <span className="mb-1 font-sans text-[0.75rem] font-medium uppercase tracking-wide text-on-surface-variant">
              Keşfedilen Bölge
            </span>
            <span className="font-sans text-4xl font-bold text-primary">
              {user.statsRegions}
              <span className="ml-1 text-xl font-medium">Bölge</span>
            </span>
          </div>
        </div>
      </section>

      <section className="mb-8 rounded-2xl bg-surface-container-low p-6">
        <h3 className="mb-4 font-sans text-lg font-bold text-primary">Profil bearbeiten</h3>
        <label className="mb-1 block text-xs font-bold uppercase text-on-surface-variant">Anzeigename</label>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="mb-6 w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-3 py-2"
        />
        <p className="mb-2 text-xs font-bold uppercase text-on-surface-variant">Icon auf der Karte</p>
        <p className="mb-3 text-xs text-on-surface-variant">
          So erscheinst du anderen, die die Karte nutzen (wenn du deine Position teilst).
        </p>
        <div className="mb-4 grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
          {MAP_MAP_ICON_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              title={opt.label}
              onClick={() => setMapIcon(opt.id)}
              className={
                mapIcon === opt.id
                  ? 'flex aspect-square items-center justify-center rounded-xl bg-primary text-on-primary ring-2 ring-amber-400'
                  : 'flex aspect-square items-center justify-center rounded-xl border border-outline-variant/40 bg-surface-container-lowest text-on-surface hover:bg-surface-container-high'
              }
            >
              <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                {opt.id}
              </span>
            </button>
          ))}
        </div>
        <label className="mb-1 block text-xs font-bold uppercase text-on-surface-variant">
          Fahrzeugklasse (Vignette / Maut)
        </label>
        <p className="mb-2 text-xs text-on-surface-variant">
          Wird für Hinweise entlang deiner Route verwendet (z. B. Pkw vs. Motorrad vs. Nutzfahrzeug).
        </p>
        <select
          value={tollVehicleClass}
          onChange={(e) => setTollVehicleClass(e.target.value as TollVehicleClass)}
          className="mb-6 w-full max-w-md rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-3 py-2 text-sm font-semibold"
        >
          <option value="car">Pkw / Kleinbus</option>
          <option value="motorcycle">Motorrad</option>
          <option value="heavy">Lkw / schweres Nutzfahrzeug</option>
          <option value="other">Sonstiges</option>
        </select>
        <button
          type="button"
          disabled={saving}
          onClick={() => void saveProfile()}
          className="rounded-xl bg-primary px-6 py-2 font-bold text-on-primary disabled:opacity-50"
        >
          {saving ? '…' : 'Speichern'}
        </button>
      </section>

      <section className="mb-12">
        <div className="mb-6 flex items-center justify-between">
          <h3 className="font-sans text-xl font-bold uppercase tracking-tighter">Fahrzeug</h3>
          {primary ? (
            <span className="rounded-full bg-primary/10 px-3 py-1 font-sans text-xs font-bold text-primary">
              Aktiv
            </span>
          ) : null}
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="rounded-xl bg-surface-container-low p-6">
            <label className="mb-1 block text-xs font-bold uppercase text-on-surface-variant">Bezeichnung</label>
            <input
              value={vLabel}
              onChange={(e) => setVLabel(e.target.value)}
              placeholder="z. B. Volvo XC90"
              className="mb-4 w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-3 py-2"
            />
            <label className="mb-1 block text-xs font-bold uppercase text-on-surface-variant">Kennzeichen</label>
            <input
              value={vPlate}
              onChange={(e) => setVPlate(e.target.value)}
              className="mb-4 w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-3 py-2"
            />
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={vTrailer}
                onChange={(e) => setVTrailer(e.target.checked)}
              />
              Römork / Anhänger-Modus
            </label>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-sans text-xl font-bold uppercase tracking-tighter">Vignetten & Maut</h3>
          <Link to="/legal/privacy" className="text-xs font-bold text-primary">
            Datenschutz
          </Link>
        </div>
        <div className="rounded-xl bg-surface-container-low px-6 py-5 text-sm leading-relaxed text-on-surface-variant">
          <p>
            Nach einer berechneten Route kannst du auf der{' '}
            <Link to="/" className="font-bold text-primary underline">
              Karte
            </Link>{' '}
            eine Service-Anfrage senden. Das Team setzt ein <strong className="text-on-surface">kumuliertes
            Gesamtangebot</strong> für deine Auswahl; danach zahlst du hier <strong className="text-on-surface">einen
            Betrag</strong> (Stripe und/oder PayPal, je nach Server-Konfiguration).
          </p>
        </div>
        <div className="mt-4 rounded-xl border border-outline-variant/40 bg-surface-container-lowest px-4 py-4">
          <p className="text-xs font-bold uppercase text-on-surface-variant">Deine Anfragen</p>
          {vignetteLoading ? (
            <p className="mt-2 text-sm text-on-surface-variant">Laden…</p>
          ) : vignetteOrders.length === 0 ? (
            <p className="mt-2 text-sm text-on-surface-variant">Noch keine Anfragen.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {vignetteOrders.map((o) => (
                <li
                  key={o.id}
                  className="flex flex-col gap-2 rounded-lg border border-outline-variant/35 bg-surface-container-high/30 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-sm font-bold text-on-surface">{o.routeLabel || 'Route'}</p>
                    <p className="text-[11px] uppercase text-primary">{o.status}</p>
                    <p className="text-xs text-on-surface-variant">
                      {new Date(o.createdAt).toLocaleString('de-DE')}
                      {o.paidAt ? ` · bezahlt ${new Date(o.paidAt).toLocaleString('de-DE')}` : ''}
                    </p>
                    {o.quotedTotalEur != null ? (
                      <p className="text-xs font-semibold text-on-surface">Angebot: {o.quotedTotalEur.toFixed(2)} €</p>
                    ) : null}
                  </div>
                  {o.canPayStripe || o.canPayPaypal ? (
                    <div className="flex shrink-0 flex-col gap-1.5">
                      {o.canPayStripe ? (
                        <button
                          type="button"
                          disabled={vignettePayBusy === `${o.id}-stripe`}
                          onClick={() => {
                            if (!token) return
                            void (async () => {
                              setVignettePayBusy(`${o.id}-stripe`)
                              try {
                                const { url } = await createVignetteStripeCheckoutSession(token, o.id)
                                window.location.href = url
                              } catch (e) {
                                setMsg(e instanceof Error ? e.message : 'Stripe-Checkout nicht möglich.')
                              } finally {
                                setVignettePayBusy(null)
                              }
                            })()
                          }}
                          className="rounded-xl bg-secondary px-4 py-2 text-xs font-black text-on-secondary disabled:opacity-40"
                        >
                          {vignettePayBusy === `${o.id}-stripe` ? '…' : 'Bezahlen (Stripe)'}
                        </button>
                      ) : null}
                      {o.canPayPaypal ? (
                        <button
                          type="button"
                          disabled={vignettePayBusy === `${o.id}-paypal`}
                          onClick={() => {
                            if (!token) return
                            void (async () => {
                              setVignettePayBusy(`${o.id}-paypal`)
                              try {
                                const { url } = await createVignettePaypalCheckoutSession(token, o.id)
                                window.location.href = url
                              } catch (e) {
                                setMsg(e instanceof Error ? e.message : 'PayPal-Checkout nicht möglich.')
                              } finally {
                                setVignettePayBusy(null)
                              }
                            })()
                          }}
                          className="rounded-xl border border-outline-variant bg-surface-container-lowest px-4 py-2 text-xs font-black text-on-surface disabled:opacity-40"
                        >
                          {vignettePayBusy === `${o.id}-paypal` ? '…' : 'Bezahlen (PayPal)'}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  )
}
