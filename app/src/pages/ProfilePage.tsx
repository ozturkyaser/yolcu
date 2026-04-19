import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  apiFetch,
  confirmVignettePaypalCheckout,
  confirmVignetteStripeCheckout,
  createVignettePaypalCheckoutSession,
  createVignetteStripeCheckoutSession,
  fetchMyVignetteOrderRequests,
  fetchProfileAi,
  saveProfileAi,
  type MyVignetteOrderDto,
  type TollVehicleClass,
  type VehicleDto,
} from '../lib/api'
import { MAP_MAP_ICON_OPTIONS, normalizeMapIconId, type MapMapIconId } from '../lib/mapIcons'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../i18n/I18nContext'
import type { Lang } from '../i18n/strings'

const BOTTOM_NAV = 'var(--bottom-nav-height, 5.75rem)'

function localeForLang(lang: string) {
  if (lang === 'tr') return 'tr-TR'
  if (lang === 'en') return 'en-GB'
  return 'de-DE'
}

export function ProfilePage() {
  const { token, user, loading: authLoading, logout, refreshMe } = useAuth()
  const { t, lang, setLang } = useI18n()
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

  const [aiLoading, setAiLoading] = useState(true)
  const [aiSaving, setAiSaving] = useState(false)
  const [aiSystemPrompt, setAiSystemPrompt] = useState('')
  const [aiIncludeFullContext, setAiIncludeFullContext] = useState(false)

  const searchQuery = useMemo(() => searchParams.toString(), [searchParams])
  const loc = localeForLang(lang)

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
        setMsg(t('profile_load_error'))
      } finally {
        setLoading(false)
      }
    })()
  }, [token, t])

  useEffect(() => {
    if (!token) {
      setAiLoading(false)
      return
    }
    let cancelled = false
    void (async () => {
      setAiLoading(true)
      try {
        const d = await fetchProfileAi(token)
        if (cancelled) return
        setAiSystemPrompt(d.aiSystemPrompt ?? '')
        setAiIncludeFullContext(d.aiIncludeFullContext)
      } catch {
        if (!cancelled) setMsg(t('profile_ai_load_error'))
      } finally {
        if (!cancelled) setAiLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token, t])

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
          setMsg(t('profile_checkout_ok'))
          const { requests } = await fetchMyVignetteOrderRequests(token)
          setVignetteOrders(requests)
        }
      } catch (e) {
        if (!cancelled) setMsg(e instanceof Error ? e.message : t('profile_checkout_fail'))
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
  }, [token, searchQuery, setSearchParams, t])

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
          setMsg(t('profile_checkout_ok_paypal'))
          const { requests } = await fetchMyVignetteOrderRequests(token)
          setVignetteOrders(requests)
        }
      } catch (e) {
        if (!cancelled) setMsg(e instanceof Error ? e.message : t('profile_checkout_fail_paypal'))
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
  }, [token, searchQuery, setSearchParams, t])

  useEffect(() => {
    const params = new URLSearchParams(searchQuery)
    const v = params.get('vignetteCheckout')
    if (v !== 'cancel' && v !== 'paypal_cancel') return
    setMsg(v === 'paypal_cancel' ? t('profile_checkout_paypal_cancel') : t('profile_checkout_cancel'))
    params.delete('vignetteCheckout')
    params.delete('token')
    params.delete('PayerID')
    setSearchParams(params, { replace: true })
  }, [searchQuery, setSearchParams, t])

  if (authLoading || (token && loading)) {
    return (
      <main className="flex min-h-[40dvh] items-center justify-center text-on-surface-variant">{t('profile_loading')}</main>
    )
  }

  if (!token || !user) {
    return (
      <main
        className="mx-auto flex min-h-[50dvh] max-w-lg flex-col items-center justify-center px-6 text-center"
        style={{ paddingBottom: `calc(${BOTTOM_NAV} + 1rem)` }}
      >
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-surface-container-high ring-1 ring-outline-variant/40">
          <span className="material-symbols-outlined text-4xl text-on-surface-variant">person</span>
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-on-surface">{t('profile_guest_title')}</h1>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-on-surface-variant">{t('profile_guest_hint')}</p>
        <Link
          to="/login"
          className="mt-8 inline-flex rounded-full bg-on-surface px-8 py-3 text-sm font-semibold text-surface shadow-md transition active:scale-[0.98]"
        >
          {t('profile_guest_cta')}
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
      setMsg(t('profile_saved'))
      await refreshMe()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Fehler')
    } finally {
      setSaving(false)
    }
  }

  async function saveAiSettings() {
    if (!token) return
    setAiSaving(true)
    setMsg(null)
    try {
      await saveProfileAi(token, {
        aiSystemPrompt: aiSystemPrompt.trim() || null,
        aiIncludeFullContext,
      })
      setMsg(t('profile_ai_saved'))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('profile_ai_save_error'))
    } finally {
      setAiSaving(false)
    }
  }

  const primary = vehicles.find((x) => x.is_primary) ?? vehicles[0]

  return (
    <main
      className="mx-auto max-w-lg px-4 pt-2"
      style={{ paddingBottom: `calc(${BOTTOM_NAV} + 0.75rem)` }}
    >
      {msg ? (
        <div className="mb-4 rounded-2xl border border-outline-variant/40 bg-primary-container/25 px-4 py-3 text-sm font-medium text-on-surface">
          {msg}
        </div>
      ) : null}

      <section className="mb-6 overflow-hidden rounded-3xl border border-outline-variant/30 bg-gradient-to-br from-surface-container-low to-surface-container-lowest shadow-sm">
        <div className="px-5 pb-5 pt-6">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <div className="relative">
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-container text-3xl font-bold text-on-primary shadow-lg ring-4 ring-white/30 dark:ring-black/20">
                {user.displayName.slice(0, 1).toUpperCase()}
              </div>
              <div className="absolute -bottom-1 -right-1 flex h-9 w-9 items-center justify-center rounded-full bg-surface shadow-md ring-2 ring-outline-variant/30">
                <span
                  className="material-symbols-outlined text-xl text-primary"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  {normalizeMapIconId(mapIcon)}
                </span>
              </div>
            </div>
            <div className="min-w-0 flex-1 text-center sm:text-left">
              <h1 className="text-2xl font-semibold tracking-tight text-on-surface">{user.displayName}</h1>
              <p className="mt-1 text-xs text-on-surface-variant">{user.email}</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2 sm:justify-start">
                {user.role === 'admin' ? (
                  <Link
                    to="/admin"
                    className="inline-flex items-center gap-1 rounded-full bg-inverse-surface px-3 py-1.5 text-xs font-semibold text-inverse-on-surface"
                  >
                    <span className="material-symbols-outlined text-sm">admin_panel_settings</span>
                    {t('profile_admin_link')}
                  </Link>
                ) : null}
                <button
                  type="button"
                  onClick={logout}
                  className="rounded-full border border-outline-variant/50 px-3 py-1.5 text-xs font-semibold text-error"
                >
                  {t('profile_logout')}
                </button>
              </div>
            </div>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-surface/80 px-4 py-3 ring-1 ring-black/[0.04] dark:ring-white/[0.06]">
              <p className="text-[11px] font-medium uppercase tracking-wide text-on-surface-variant">
                {t('profile_stats_km')}
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-primary">
                {user.statsKm.toLocaleString(loc)}
                <span className="ml-1 text-sm font-medium text-on-surface-variant">{t('profile_stats_km_unit')}</span>
              </p>
            </div>
            <div className="rounded-2xl bg-surface/80 px-4 py-3 ring-1 ring-black/[0.04] dark:ring-white/[0.06]">
              <p className="text-[11px] font-medium uppercase tracking-wide text-on-surface-variant">
                {t('profile_stats_regions')}
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-primary">
                {user.statsRegions}
                <span className="ml-1 text-sm font-medium text-on-surface-variant">
                  {t('profile_stats_regions_unit')}
                </span>
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="mb-5 rounded-3xl border border-outline-variant/30 bg-surface-container-low/90 p-5 shadow-sm">
        <h2 className="text-base font-semibold text-on-surface">{t('profile_lang_title')}</h2>
        <p className="mt-1 text-sm text-on-surface-variant">{t('profile_lang_hint')}</p>
        <label className="sr-only" htmlFor="profile-lang">
          {t('langLabel')}
        </label>
        <select
          id="profile-lang"
          value={lang}
          onChange={(e) => setLang(e.target.value as Lang)}
          className="mt-4 w-full rounded-2xl border border-outline-variant/40 bg-surface px-3 py-3 text-sm font-semibold"
        >
          <option value="de">{t('langOptionDe')}</option>
          <option value="tr">{t('langOptionTr')}</option>
          <option value="en">{t('langOptionEn')}</option>
        </select>
      </section>

      <section className="mb-5 rounded-3xl border border-outline-variant/30 bg-surface-container-low/90 p-5 shadow-sm">
        <h2 className="text-base font-semibold text-on-surface">{t('profile_ai_section')}</h2>
        <p className="mt-1 text-sm leading-relaxed text-on-surface-variant">{t('profile_ai_intro')}</p>
        {aiLoading ? (
          <p className="mt-4 text-sm text-on-surface-variant">{t('profile_loading')}</p>
        ) : (
          <>
            <label className="mt-4 block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">
              {t('profile_ai_prompt')}
            </label>
            <p className="mt-1 text-xs text-on-surface-variant">{t('profile_ai_prompt_hint')}</p>
            <textarea
              value={aiSystemPrompt}
              onChange={(e) => setAiSystemPrompt(e.target.value)}
              rows={5}
              placeholder={t('profile_ai_prompt_ph')}
              className="mt-2 w-full resize-y rounded-2xl border border-outline-variant/40 bg-surface px-3 py-2.5 text-sm"
            />
            <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={aiIncludeFullContext}
                onChange={(e) => setAiIncludeFullContext(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-outline-variant accent-primary"
              />
              <span>
                <span className="font-semibold text-on-surface">{t('profile_ai_full_ctx')}</span>
                <span className="mt-0.5 block text-xs text-on-surface-variant">{t('profile_ai_full_ctx_hint')}</span>
              </span>
            </label>
            <button
              type="button"
              disabled={aiSaving}
              onClick={() => void saveAiSettings()}
              className="mt-5 rounded-full bg-tertiary px-6 py-2.5 text-sm font-semibold text-on-tertiary disabled:opacity-50"
            >
              {aiSaving ? t('profile_saving') : t('profile_ai_save')}
            </button>
          </>
        )}
      </section>

      <section className="mb-5 rounded-3xl border border-outline-variant/30 bg-surface-container-low/90 p-5 shadow-sm">
        <h2 className="text-base font-semibold text-on-surface">{t('profile_section_edit')}</h2>
        <label className="mt-4 block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">
          {t('profile_display_name')}
        </label>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="mt-1.5 w-full rounded-2xl border border-outline-variant/40 bg-surface px-3 py-2.5 text-sm"
        />
        <p className="mt-5 text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">
          {t('profile_map_icon_title')}
        </p>
        <p className="mt-1 text-xs text-on-surface-variant">{t('profile_map_icon_hint')}</p>
        <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6">
          {MAP_MAP_ICON_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              title={opt.label}
              onClick={() => setMapIcon(opt.id)}
              className={
                mapIcon === opt.id
                  ? 'flex aspect-square items-center justify-center rounded-2xl bg-primary text-on-primary ring-2 ring-amber-400/90'
                  : 'flex aspect-square items-center justify-center rounded-2xl border border-outline-variant/35 bg-surface text-on-surface transition hover:bg-surface-container-high'
              }
            >
              <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                {opt.id}
              </span>
            </button>
          ))}
        </div>
        <label className="mt-5 block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">
          {t('profile_toll_class_title')}
        </label>
        <p className="mt-1 text-xs text-on-surface-variant">{t('profile_toll_class_hint')}</p>
        <select
          value={tollVehicleClass}
          onChange={(e) => setTollVehicleClass(e.target.value as TollVehicleClass)}
          className="mt-2 w-full rounded-2xl border border-outline-variant/40 bg-surface px-3 py-2.5 text-sm font-semibold"
        >
          <option value="car">{t('profile_toll_car')}</option>
          <option value="motorcycle">{t('profile_toll_motorcycle')}</option>
          <option value="heavy">{t('profile_toll_heavy')}</option>
          <option value="other">{t('profile_toll_other')}</option>
        </select>
        <button
          type="button"
          disabled={saving}
          onClick={() => void saveProfile()}
          className="mt-5 rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-on-primary disabled:opacity-50"
        >
          {saving ? t('profile_saving') : t('profile_save')}
        </button>
      </section>

      <section className="mb-5 rounded-3xl border border-outline-variant/30 bg-surface-container-low/90 p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-on-surface">{t('profile_vehicle_section')}</h2>
          {primary ? (
            <span className="rounded-full bg-primary/12 px-2.5 py-0.5 text-[11px] font-bold text-primary">
              {t('profile_vehicle_active')}
            </span>
          ) : null}
        </div>
        <label className="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">
          {t('profile_vehicle_label')}
        </label>
        <input
          value={vLabel}
          onChange={(e) => setVLabel(e.target.value)}
          placeholder={t('profile_vehicle_label_ph')}
          className="mt-1.5 w-full rounded-2xl border border-outline-variant/40 bg-surface px-3 py-2.5 text-sm"
        />
        <label className="mt-4 block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">
          {t('profile_vehicle_plate')}
        </label>
        <input
          value={vPlate}
          onChange={(e) => setVPlate(e.target.value)}
          className="mt-1.5 w-full rounded-2xl border border-outline-variant/40 bg-surface px-3 py-2.5 text-sm"
        />
        <label className="mt-4 flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={vTrailer} onChange={(e) => setVTrailer(e.target.checked)} />
          {t('profile_vehicle_trailer')}
        </label>
      </section>

      <section className="rounded-3xl border border-outline-variant/30 bg-surface-container-low/90 p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-on-surface">{t('profile_vignette_section')}</h2>
          <Link to="/legal/privacy" className="text-xs font-semibold text-primary">
            {t('profile_vignette_privacy')}
          </Link>
        </div>
        <p className="text-sm leading-relaxed text-on-surface-variant">
          {t('profile_vignette_intro_pre')}{' '}
          <Link to="/" className="font-semibold text-primary underline">
            {t('profile_vignette_map_link')}
          </Link>
          {t('profile_vignette_intro_post')}
        </p>
        <div className="mt-5 rounded-2xl border border-outline-variant/35 bg-surface px-4 py-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">{t('profile_vignette_requests')}</p>
          {vignetteLoading ? (
            <p className="mt-2 text-sm text-on-surface-variant">{t('profile_vignette_loading')}</p>
          ) : vignetteOrders.length === 0 ? (
            <p className="mt-2 text-sm text-on-surface-variant">{t('profile_vignette_empty')}</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {vignetteOrders.map((o) => (
                <li
                  key={o.id}
                  className="flex flex-col gap-2 rounded-2xl border border-outline-variant/30 bg-surface-container-high/25 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-sm font-semibold text-on-surface">{o.routeLabel || t('profile_vignette_route')}</p>
                    <p className="text-[11px] font-bold uppercase text-primary">{o.status}</p>
                    <p className="text-xs text-on-surface-variant">
                      {new Date(o.createdAt).toLocaleString(loc)}
                      {o.paidAt
                        ? ` · ${t('profile_vignette_paid')} ${new Date(o.paidAt).toLocaleString(loc)}`
                        : ''}
                    </p>
                    {o.quotedTotalEur != null ? (
                      <p className="text-xs font-semibold text-on-surface">
                        {t('profile_vignette_quoted')}: {o.quotedTotalEur.toFixed(2)} €
                      </p>
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
                                setMsg(e instanceof Error ? e.message : t('profile_checkout_fail'))
                              } finally {
                                setVignettePayBusy(null)
                              }
                            })()
                          }}
                          className="rounded-xl bg-secondary px-4 py-2 text-xs font-bold text-on-secondary disabled:opacity-40"
                        >
                          {vignettePayBusy === `${o.id}-stripe` ? t('profile_pay_busy') : t('profile_pay_stripe')}
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
                                setMsg(e instanceof Error ? e.message : t('profile_checkout_fail_paypal'))
                              } finally {
                                setVignettePayBusy(null)
                              }
                            })()
                          }}
                          className="rounded-xl border border-outline-variant bg-surface px-4 py-2 text-xs font-bold text-on-surface disabled:opacity-40"
                        >
                          {vignettePayBusy === `${o.id}-paypal` ? t('profile_pay_busy') : t('profile_pay_paypal')}
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
