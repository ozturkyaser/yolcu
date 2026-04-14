import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../i18n/I18nContext'
import type { Lang } from '../i18n/strings'

type AppHeaderProps = {
  title?: string
  showBack?: boolean
}

export function AppHeader({ title, showBack }: AppHeaderProps) {
  const { user, loading } = useAuth()
  const { lang, setLang, t } = useI18n()
  const displayTitle = title ?? t('appTitle')

  return (
    <header className="fixed top-0 z-50 flex w-full items-center justify-between bg-surface px-6 py-4 shadow-[0_8px_32px_rgba(26,28,28,0.08)]">
      <div className="flex min-w-0 items-center gap-4">
        {showBack ? (
          <Link
            to="/"
            className="scale-95 shrink-0 text-primary transition-transform active:scale-90 dark:text-white"
            aria-label="Zurück"
          >
            <span className="material-symbols-outlined text-2xl">arrow_back</span>
          </Link>
        ) : (
          <button
            type="button"
            className="scale-95 shrink-0 text-primary transition-transform active:scale-90 dark:text-white"
            aria-label="Suche"
          >
            <span className="material-symbols-outlined">search</span>
          </button>
        )}
        <h1 className="truncate font-sans text-2xl font-bold tracking-tight text-primary sm:text-3xl dark:text-white">
          {displayTitle}
        </h1>
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-4">
        <label className="sr-only" htmlFor="yol-lang">
          Sprache
        </label>
        <select
          id="yol-lang"
          value={lang}
          onChange={(e) => setLang(e.target.value as Lang)}
          className="max-w-[4.5rem] rounded-lg border border-outline-variant/40 bg-surface-container-low px-1 py-1 text-[10px] font-bold text-on-surface"
          aria-label="Sprache"
        >
          <option value="de">DE</option>
          <option value="tr">TR</option>
          <option value="en">EN</option>
        </select>
        {!loading && user ? (
          <>
            <Link
              to="/groups"
              className="flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-1 text-primary hover:bg-surface-container-low sm:px-2"
              aria-label={t('navGroups')}
            >
              <span className="material-symbols-outlined text-[22px] sm:text-2xl">groups</span>
              <span className="hidden text-xs font-bold sm:inline">{t('navGroups')}</span>
            </Link>
            <Link
              to="/profile"
              className="max-w-[100px] truncate text-sm font-bold text-primary underline sm:max-w-[140px]"
            >
              {user.displayName}
            </Link>
          </>
        ) : !loading ? (
          <Link to="/login" className="text-sm font-bold text-primary">
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
