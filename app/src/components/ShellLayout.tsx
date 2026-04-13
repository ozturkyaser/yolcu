import { Outlet } from 'react-router-dom'
import { AppHeader } from './AppHeader'
import { BottomNav } from './BottomNav'

export function ShellLayout() {
  return (
    <div className="min-h-dvh bg-surface font-sans text-on-surface">
      <AppHeader />
      <div className="h-[72px]" aria-hidden />
      <Outlet />
      <div className="h-24" aria-hidden />
      <BottomNav />
    </div>
  )
}
