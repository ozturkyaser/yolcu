import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useI18n } from '../i18n/I18nContext'
import { useAuth } from '../context/AuthContext'
import { fetchGroups, type GroupSummary } from '../lib/api'
import { hasActiveNavSession } from '../lib/navSession'
import { GroupQuickWalkie } from './GroupQuickWalkie'

export function BottomNav() {
  const { t } = useI18n()
  const { token, user } = useAuth()
  const navRef = useRef<HTMLElement>(null)
  const [hasActiveNavigation, setHasActiveNavigation] = useState(false)
  const [walkieGroups, setWalkieGroups] = useState<GroupSummary[]>([])

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

  useEffect(() => {
    if (!token || !user) {
      setWalkieGroups([])
      return
    }
    let cancelled = false
    void fetchGroups(token)
      .then((d) => {
        if (!cancelled) setWalkieGroups(d.groups)
      })
      .catch(() => {
        if (!cancelled) setWalkieGroups([])
      })
    return () => {
      cancelled = true
    }
  }, [token, user])

  const leftNav = [
    { to: '/', label: t('navMap'), icon: 'explore' as const, end: true },
    { to: '/community', label: t('navCommunity'), icon: 'forum' as const, end: false },
    { to: '/rides', label: t('navMarketplace'), icon: 'storefront' as const, end: false },
  ]

  const navItemCls = (isActive: boolean) =>
    [
      'relative flex min-h-[3.25rem] min-w-0 flex-col items-center justify-center rounded-xl px-0.5 py-1 transition-all duration-300 sm:px-2',
      isActive
        ? 'bg-gradient-to-br from-primary to-primary-container text-on-primary'
        : 'text-inverse-surface opacity-60 hover:bg-surface-container-low dark:text-surface-dim',
    ].join(' ')

  return (
    <nav
      ref={navRef}
      className="fixed bottom-0 left-0 z-50 grid w-full grid-cols-6 items-end gap-0 rounded-t-3xl bg-surface-container-lowest/80 px-0.5 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_32px_rgba(26,28,28,0.08)] backdrop-blur-3xl dark:bg-inverse-surface/80 sm:px-2"
    >
      {leftNav.map(({ to, label, icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => navItemCls(isActive)}>
          {to === '/' && hasActiveNavigation ? (
            <span
              className="absolute top-1 right-2 h-2 w-2 rounded-full bg-secondary ring-2 ring-surface-container-lowest dark:ring-inverse-surface sm:right-3 sm:h-2.5 sm:w-2.5"
              title="Navigation aktiv"
              aria-label="Navigation aktiv"
            />
          ) : null}
          <span className="material-symbols-outlined text-[22px] sm:text-2xl">{icon}</span>
          <span className="line-clamp-2 max-w-full text-center font-sans text-[0.58rem] font-medium uppercase leading-tight tracking-wide sm:text-[0.7rem]">
            {label}
          </span>
        </NavLink>
      ))}

      <div className="flex min-h-0 flex-col items-center justify-end pb-0.5">
        <GroupQuickWalkie
          dock="bottom-nav"
          token={token}
          user={user}
          groups={walkieGroups}
          mapGroupFilter="all"
        />
      </div>

      <NavLink to="/groups" className={({ isActive }) => navItemCls(isActive)}>
        <span className="material-symbols-outlined text-[22px] sm:text-2xl">groups</span>
        <span className="line-clamp-2 max-w-full text-center font-sans text-[0.58rem] font-medium uppercase leading-tight tracking-wide sm:text-[0.7rem]">
          {t('navGroups')}
        </span>
      </NavLink>

      <NavLink to="/profile" className={({ isActive }) => navItemCls(isActive)}>
        <span className="material-symbols-outlined text-[22px] sm:text-2xl">person</span>
        <span className="line-clamp-2 max-w-full text-center font-sans text-[0.58rem] font-medium uppercase leading-tight tracking-wide sm:text-[0.7rem]">
          {t('navProfile')}
        </span>
      </NavLink>
    </nav>
  )
}
