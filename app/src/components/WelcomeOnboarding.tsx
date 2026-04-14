import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useI18n } from '../i18n/I18nContext'

const LS_DONE = 'yol_onboarding_v1_done'

const STEPS = [
  { icon: 'waving_hand' as const, accent: 'from-primary to-primary-container' },
  { icon: 'map' as const, accent: 'from-secondary-container to-secondary' },
  { icon: 'forum' as const, accent: 'from-tertiary to-secondary' },
  { icon: 'groups' as const, accent: 'from-primary-container to-primary' },
  { icon: 'person' as const, accent: 'from-surface-container-high to-primary/35' },
  { icon: 'rocket_launch' as const, accent: 'from-primary to-secondary-container' },
] as const

function readCompleted(): boolean {
  try {
    return localStorage.getItem(LS_DONE) === '1'
  } catch {
    return false
  }
}

function writeCompleted() {
  try {
    localStorage.setItem(LS_DONE, '1')
  } catch {
    /* ignore */
  }
}

export function WelcomeOnboarding() {
  const { t } = useI18n()
  const location = useLocation()
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const prevFocus = useRef<HTMLElement | null>(null)
  const storedOpeningFocus = useRef(false)

  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return false
    return !readCompleted()
  })
  const [step, setStep] = useState(0)

  const finish = useCallback(() => {
    writeCompleted()
    setOpen(false)
    prevFocus.current?.focus?.()
    prevFocus.current = null
  }, [])

  const skipLegal = location.pathname.startsWith('/legal')
  const active = open && !skipLegal

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        finish()
      }
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [active, finish])

  useEffect(() => {
    if (!active) {
      storedOpeningFocus.current = false
      return
    }
    if (!storedOpeningFocus.current) {
      storedOpeningFocus.current = true
      prevFocus.current = document.activeElement as HTMLElement | null
    }
    const tId = window.setTimeout(() => {
      dialogRef.current?.querySelector<HTMLElement>('button[data-onboarding-primary]')?.focus()
    }, 50)
    return () => window.clearTimeout(tId)
  }, [active, step])

  if (!active) return null

  const last = step === STEPS.length - 1
  const stepMeta = STEPS[step]

  return (
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="presentation"
    >
      <button
        type="button"
        aria-label={t('onboarding_closeBackdrop')}
        className="absolute inset-0 bg-on-surface/45 backdrop-blur-sm transition-opacity"
        onClick={finish}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[min(92dvh,840px)] w-full max-w-lg flex-col overflow-hidden rounded-t-[1.75rem] border border-outline-variant/60 bg-surface-container-lowest shadow-[0_-12px_48px_rgba(26,28,28,0.18)] sm:max-h-[90dvh] sm:rounded-3xl sm:shadow-2xl"
      >
        <div
          className={`relative shrink-0 bg-gradient-to-br px-6 pt-7 pb-8 text-on-primary ${stepMeta.accent}`}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-[0.65rem] font-bold uppercase tracking-[0.2em] text-on-primary/90">
              {t('onboarding_kicker')}
            </p>
            <button
              type="button"
              onClick={finish}
              className="rounded-full p-1.5 text-on-primary/90 transition hover:bg-on-primary/15 hover:text-on-primary"
              aria-label={t('onboarding_skip')}
            >
              <span className="material-symbols-outlined text-[22px]">close</span>
            </button>
          </div>
          <div className="mt-5 flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-on-primary/15 ring-2 ring-on-primary/25">
              <span className="material-symbols-outlined text-[34px] text-on-primary" style={{ fontVariationSettings: "'FILL' 1" }}>
                {stepMeta.icon}
              </span>
            </div>
            <h2 id={titleId} className="text-xl font-bold leading-snug tracking-tight sm:text-2xl">
              {t(`onboarding_s${step}_title`)}
            </h2>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <p className="text-[0.95rem] leading-relaxed text-on-surface-variant sm:text-base">
            {t(`onboarding_s${step}_body`)}
          </p>
          {step === 1 ? (
            <ul className="mt-4 space-y-2 text-sm text-on-surface-variant">
              <li className="flex gap-2">
                <span className="material-symbols-outlined mt-0.5 shrink-0 text-lg text-primary">check_circle</span>
                <span>{t('onboarding_s1_b1')}</span>
              </li>
              <li className="flex gap-2">
                <span className="material-symbols-outlined mt-0.5 shrink-0 text-lg text-primary">check_circle</span>
                <span>{t('onboarding_s1_b2')}</span>
              </li>
              <li className="flex gap-2">
                <span className="material-symbols-outlined mt-0.5 shrink-0 text-lg text-primary">check_circle</span>
                <span>{t('onboarding_s1_b3')}</span>
              </li>
            </ul>
          ) : null}
        </div>

        <div className="shrink-0 border-t border-outline-variant/50 bg-surface-container-low/80 px-6 py-4 backdrop-blur-md">
          <div className="mb-4 flex justify-center gap-1.5" aria-label={t('onboarding_progress')}>
            {STEPS.map((_, i) => (
              <span
                key={i}
                role="presentation"
                className={[
                  'h-1.5 rounded-full transition-all duration-300',
                  i === step ? 'w-8 bg-primary' : i < step ? 'w-2 bg-primary/45' : 'w-2 bg-outline-variant',
                ].join(' ')}
              />
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={finish}
              className="text-sm font-semibold text-on-surface-variant underline-offset-4 hover:text-on-surface hover:underline"
            >
              {t('onboarding_skip')}
            </button>
            <div className="flex gap-2">
              {step > 0 ? (
                <button
                  type="button"
                  onClick={() => setStep((s) => Math.max(0, s - 1))}
                  className="rounded-full border border-outline-variant px-4 py-2.5 text-sm font-bold text-on-surface transition hover:bg-surface-container-high active:scale-[0.98]"
                >
                  {t('onboarding_back')}
                </button>
              ) : null}
              {last ? (
                <button
                  type="button"
                  data-onboarding-primary
                  onClick={finish}
                  className="rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-on-primary shadow-lg ring-2 ring-primary/20 transition hover:bg-primary-container active:scale-[0.98]"
                >
                  {t('onboarding_done')}
                </button>
              ) : (
                <button
                  type="button"
                  data-onboarding-primary
                  onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
                  className="rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-on-primary shadow-lg ring-2 ring-primary/20 transition hover:bg-primary-container active:scale-[0.98]"
                >
                  {t('onboarding_next')}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
