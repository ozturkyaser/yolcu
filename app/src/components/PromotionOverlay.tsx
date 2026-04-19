import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import {
  fetchActivePromotion,
  trackPromotionClick,
  trackPromotionImpression,
  type ActivePromotionDto,
} from '../lib/api'
import { useI18n } from '../i18n/I18nContext'

/** Session: bis Tab schließen (showAgainAfterMinutes === 0). */
const SESSION_DISMISS_PREFIX = 'yol_promo_dismiss_'
/** Zeitgestützt: ISO-Zeitpunkt des letzten Schließens (Mindestabstand pro Kampagne). */
const LOCAL_SNOOZE_PREFIX = 'yol_promo_snooze_'

function isPromotionSnoozed(id: string, showAgainAfterMinutes: number): boolean {
  const mins = Number.isFinite(showAgainAfterMinutes) ? showAgainAfterMinutes : 60
  try {
    if (mins <= 0) {
      return sessionStorage.getItem(SESSION_DISMISS_PREFIX + id) === '1'
    }
    const at = localStorage.getItem(LOCAL_SNOOZE_PREFIX + id)
    if (at) {
      const t = new Date(at).getTime()
      if (!Number.isNaN(t) && Date.now() - t < mins * 60 * 1000) {
        return true
      }
    }
    // Gleiche Sitzung: früher nur Session-Dismiss (ohne Zeitstempel)
    if (sessionStorage.getItem(SESSION_DISMISS_PREFIX + id) === '1') {
      return true
    }
  } catch {
    /* private mode etc. */
  }
  return false
}

function rememberDismiss(id: string, showAgainAfterMinutes: number) {
  const mins = Number.isFinite(showAgainAfterMinutes) ? showAgainAfterMinutes : 60
  try {
    if (mins <= 0) {
      sessionStorage.setItem(SESSION_DISMISS_PREFIX + id, '1')
      localStorage.removeItem(LOCAL_SNOOZE_PREFIX + id)
    } else {
      localStorage.setItem(LOCAL_SNOOZE_PREFIX + id, new Date().toISOString())
      sessionStorage.removeItem(SESSION_DISMISS_PREFIX + id)
    }
  } catch {
    /* ignore */
  }
}

export function PromotionOverlay() {
  const { lang, t } = useI18n()
  const location = useLocation()
  const [promo, setPromo] = useState<ActivePromotionDto | null>(null)
  const trackedId = useRef<string | null>(null)

  const hideOverlay =
    location.pathname.startsWith('/admin') ||
    location.pathname === '/login' ||
    location.pathname === '/register'

  useEffect(() => {
    if (hideOverlay) {
      setPromo(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const { promotion } = await fetchActivePromotion(lang)
        if (cancelled) return
        if (!promotion) {
          setPromo(null)
          return
        }
        const interval = promotion.showAgainAfterMinutes ?? 60
        if (isPromotionSnoozed(promotion.id, interval)) {
          setPromo(null)
          return
        }
        setPromo(promotion)
      } catch {
        if (!cancelled) setPromo(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [lang, hideOverlay, location.pathname])

  useEffect(() => {
    if (!promo) return
    if (trackedId.current === promo.id) return
    trackedId.current = promo.id
    void trackPromotionImpression(promo.id).catch(() => {
      /* ignore */
    })
  }, [promo])

  function dismiss() {
    if (promo) {
      rememberDismiss(promo.id, promo.showAgainAfterMinutes ?? 60)
    }
    setPromo(null)
  }

  async function onCta() {
    if (!promo) return
    try {
      const { ctaUrl } = await trackPromotionClick(promo.id)
      const url = (ctaUrl || promo.ctaUrl).trim()
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
    } catch {
      window.open(promo.ctaUrl, '_blank', 'noopener,noreferrer')
    }
    dismiss()
  }

  if (!promo || typeof document === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/45 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-[2px] sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="promo-headline"
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-t-[1.35rem] border border-white/10 bg-surface shadow-[0_24px_80px_rgba(0,0,0,0.35)] sm:rounded-[1.35rem]">
        <button
          type="button"
          onClick={dismiss}
          className="absolute right-2 top-2 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/25 text-white backdrop-blur-md transition hover:bg-black/35"
          aria-label={t('promo_close')}
        >
          <span className="material-symbols-outlined text-[22px]">close</span>
        </button>
        <p className="absolute left-3 top-3 z-10 rounded-full bg-black/35 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white backdrop-blur-md">
          {t('promo_sponsored')}
        </p>
        {promo.imageUrl ? (
          <div className="aspect-[21/9] w-full bg-surface-container-high sm:aspect-[2/1]">
            <img src={promo.imageUrl} alt="" className="h-full w-full object-cover" loading="eager" />
          </div>
        ) : null}
        <div className="space-y-3 px-4 pb-5 pt-4">
          <h2 id="promo-headline" className="pr-10 text-lg font-semibold leading-snug tracking-tight text-on-surface">
            {promo.headline}
          </h2>
          {promo.body ? (
            <p className="text-sm leading-relaxed text-on-surface-variant whitespace-pre-wrap">{promo.body}</p>
          ) : null}
          <button
            type="button"
            onClick={() => void onCta()}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 text-sm font-semibold text-on-primary shadow-md transition active:scale-[0.99]"
          >
            {promo.ctaLabel}
            <span className="material-symbols-outlined text-lg">open_in_new</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
