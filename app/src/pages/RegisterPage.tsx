import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../i18n/I18nContext'
import type { Lang } from '../i18n/strings'
import { AppLogoWithWordmark } from '../components/AppLogo'

export function RegisterPage() {
  const { register } = useAuth()
  const { t, lang, setLang } = useI18n()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await register(email, password, displayName)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('register_error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-surface px-6 py-10 font-sans text-on-surface sm:py-12">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link to="/" className="text-sm font-bold text-primary">
          ← {t('auth_back')}
        </Link>
        <div className="flex items-center gap-2">
          <label htmlFor="register-lang" className="sr-only">
            {t('langLabel')}
          </label>
          <select
            id="register-lang"
            value={lang}
            onChange={(e) => setLang(e.target.value as Lang)}
            className="rounded-lg border border-outline-variant/40 bg-surface-container-low px-2 py-1.5 text-xs font-bold text-on-surface"
          >
            <option value="de">{t('langOptionDe')}</option>
            <option value="tr">{t('langOptionTr')}</option>
            <option value="en">{t('langOptionEn')}</option>
          </select>
        </div>
      </div>

      <div className="mb-8">
        <AppLogoWithWordmark />
        <h1 className="mt-6 text-3xl font-bold text-primary">{t('registerTitle')}</h1>
        <p className="mt-2 text-on-surface-variant">{t('registerSubtitle')}</p>
      </div>

      <form onSubmit={onSubmit} className="mx-auto w-full max-w-md space-y-4">
        {error ? (
          <div className="rounded-xl bg-error-container px-4 py-3 text-sm text-on-error-container">{error}</div>
        ) : null}
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
            {t('register_display')}
          </label>
          <input
            type="text"
            required
            minLength={1}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-4 py-3 outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
            {t('login_email')}
          </label>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-4 py-3 outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-on-surface-variant">
            {t('login_password')}
          </label>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-4 py-3 outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-gradient-to-br from-primary to-primary-container py-4 font-bold text-on-primary disabled:opacity-50"
        >
          {busy ? '…' : t('register_submit')}
        </button>
      </form>

      <p className="mx-auto mt-8 max-w-md text-center text-sm text-on-surface-variant">
        {t('register_has_account')}{' '}
        <Link to="/login" className="font-bold text-primary">
          {t('login')}
        </Link>
      </p>
    </div>
  )
}
