import { Outlet } from 'react-router-dom'
import { AppHeader } from './AppHeader'
import { BottomNav } from './BottomNav'
import { PromotionOverlay } from './PromotionOverlay'

export function ShellLayout() {
  return (
    <div className="min-h-dvh bg-surface font-sans text-on-surface">
      <PromotionOverlay />
      <AppHeader />
      <div className="h-[72px]" aria-hidden />
      <Outlet />
      <div className="h-24" aria-hidden />
      <BottomNav />
    </div>
  )
}
