import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../i18n/I18nContext'
import type { Lang } from '../i18n/strings'
import { AppLogoMark } from './AppLogo'

type AppHeaderProps = {
  title?: string
  showBack?: boolean
}

export function AppHeader({ title, showBack }: AppHeaderProps) {
  const { user, loading } = useAuth()
  const { lang, setLang, t } = useI18n()
  const displayTitle = title ?? t('appTitle')

  return (
    <header className="fixed top-0 z-50 flex w-full items-center justify-between bg-surface px-4 py-3 shadow-[0_8px_32px_rgba(26,28,28,0.08)] sm:px-6 sm:py-4">
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        {showBack ? (
          <Link
            to="/"
            className="scale-95 shrink-0 text-primary transition-transform active:scale-90 dark:text-white"
            aria-label={t('auth_back')}
          >
            <span className="material-symbols-outlined text-2xl">arrow_back</span>
          </Link>
        ) : (
          <button
            type="button"
            className="scale-95 shrink-0 text-primary transition-transform active:scale-90 dark:text-white"
            aria-label={t('header_search')}
          >
            <span className="material-symbols-outlined">search</span>
          </button>
        )}
        {title ? (
          <h1 className="truncate font-sans text-xl font-bold tracking-tight text-primary sm:text-2xl dark:text-white">
            {displayTitle}
          </h1>
        ) : (
          <Link
            to="/"
            className="flex min-w-0 items-center gap-2.5 rounded-xl outline-none ring-primary/40 focus-visible:ring-2"
            aria-label={t('appTitle')}
          >
            <AppLogoMark className="h-8 w-8 shrink-0 text-primary sm:h-9 sm:w-9 dark:text-white" />
            <span className="hidden font-sans text-xl font-black tracking-tight text-primary sm:inline dark:text-white">
              Yol
            </span>
          </Link>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
        <label className="sr-only" htmlFor="yol-lang">
          {t('langLabel')}
        </label>
        <select
          id="yol-lang"
          value={lang}
          onChange={(e) => setLang(e.target.value as Lang)}
          className="max-w-[9rem] rounded-lg border border-outline-variant/40 bg-surface-container-low px-1.5 py-1.5 text-[11px] font-bold text-on-surface sm:max-w-none sm:px-2 sm:text-xs"
          aria-label={t('langLabel')}
        >
          <option value="de">{t('langOptionDe')}</option>
          <option value="tr">{t('langOptionTr')}</option>
          <option value="en">{t('langOptionEn')}</option>
        </select>
        {!loading && user ? (
          <>
            <Link
              to="/groups"
              className="flex shrink-0 items-center gap-1 rounded-lg px-1 py-1 text-primary hover:bg-surface-container-low sm:px-2"
              aria-label={t('navGroups')}
            >
              <span className="material-symbols-outlined text-[20px] sm:text-2xl">groups</span>
              <span className="hidden text-xs font-bold sm:inline">{t('navGroups')}</span>
            </Link>
            <Link
              to="/profile"
              className="max-w-[88px] truncate text-xs font-bold text-primary underline sm:max-w-[140px] sm:text-sm"
            >
              {user.displayName}
            </Link>
          </>
        ) : !loading ? (
          <Link to="/login" className="text-xs font-bold text-primary sm:text-sm">
            {t('login')}
          </Link>
        ) : null}
        <Link
          to="/legal/privacy"
          className="hidden text-on-surface-variant sm:inline text-xs font-medium"
          aria-label="Datenschutz"
        >
          {t('privacyHint')}
        </Link>
      </div>
    </header>
  )
}
