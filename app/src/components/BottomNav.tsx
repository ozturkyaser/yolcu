import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useI18n } from '../i18n/I18nContext'
import { hasActiveNavSession } from '../lib/navSession'

export function BottomNav() {
  const { t } = useI18n()
  const navRef = useRef<HTMLElement>(null)
  const [hasActiveNavigation, setHasActiveNavigation] = useState(false)

  useLayoutEffect(() => {
    const el = navRef.current
    if (!el || typeof document === 'undefined') return
    const root = document.documentElement
    const publish = () => {
      root.style.setProperty('--bottom-nav-height', `${Math.round(el.getBoundingClientRect().height)}px`)
    }
    publish()
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    window.addEventListener('resize', publish)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', publish)
      root.style.removeProperty('--bottom-nav-height')
    }
  }, [])

  useEffect(() => {
    const refresh = () => setHasActiveNavigation(hasActiveNavSession())
    refresh()
    const id = window.setInterval(refresh, 1500)
    window.addEventListener('storage', refresh)
    return () => {
      clearInterval(id)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  const nav = [
    { to: '/', label: t('navMap'), icon: 'explore' as const },
    { to: '/community', label: t('navCommunity'), icon: 'forum' as const },
    { to: '/groups', label: t('navGroups'), icon: 'chat' as const },
    { to: '/profile', label: t('navProfile'), icon: 'person' as const },
  ]
  return (
    <nav
      ref={navRef}
      className="fixed bottom-0 left-0 z-50 flex w-full justify-around rounded-t-3xl bg-surface-container-lowest/80 px-4 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-[0_-8px_32px_rgba(26,28,28,0.08)] backdrop-blur-3xl dark:bg-inverse-surface/80"
    >
      {nav.map(({ to, label, icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            [
              'relative flex min-w-0 flex-1 flex-col items-center justify-center rounded-xl px-2 py-2 transition-all duration-300 sm:px-4',
              isActive
                ? 'bg-gradient-to-br from-primary to-primary-container text-on-primary'
                : 'text-inverse-surface opacity-60 hover:bg-surface-container-low dark:text-surface-dim',
            ].join(' ')
          }
        >
          {to === '/' && hasActiveNavigation ? (
            <span
              className="absolute top-1.5 right-3 h-2.5 w-2.5 rounded-full bg-secondary ring-2 ring-surface-container-lowest dark:ring-inverse-surface"
              title="Navigation aktiv"
              aria-label="Navigation aktiv"
            />
          ) : null}
          <span className="material-symbols-outlined">{icon}</span>
          <span className="font-sans text-[0.75rem] font-medium uppercase tracking-wide">{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
