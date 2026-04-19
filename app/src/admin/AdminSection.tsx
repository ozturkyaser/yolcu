import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { AdminDashboardPage } from './AdminDashboardPage'
import { AdminPlacesPage } from './AdminPlacesPage'
import { AdminRidesPage } from './AdminRidesPage'
import { AdminUsersPage } from './AdminUsersPage'
import { AdminVignetteOrdersPage } from './AdminVignetteOrdersPage'
import { AdminVignetteProductsPage } from './AdminVignetteProductsPage'
import { AdminPaymentSettingsPage } from './AdminPaymentSettingsPage'
import { AdminRadioChannelsPage } from './AdminRadioChannelsPage'
import { AdminPromotionsPage } from './AdminPromotionsPage'

const navCls = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-2 text-sm font-bold ${isActive ? 'bg-primary text-on-primary' : 'text-on-surface hover:bg-surface-container-high'}`

export function AdminSection() {
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-surface text-on-surface-variant">Laden…</div>
    )
  }
  if (user?.role !== 'admin') {
    return <Navigate to="/" replace />
  }

  return (
    <div className="flex min-h-dvh flex-col bg-surface text-on-surface md:flex-row">
      <aside className="shrink-0 border-b border-outline-variant/40 md:w-56 md:border-r md:border-b-0">
        <div className="flex items-center justify-between gap-2 p-3 md:flex-col md:items-stretch">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-on-surface-variant">Yol Admin</p>
            <p className="truncate text-sm font-black">{user.displayName}</p>
          </div>
          <Link
            to="/"
            className="shrink-0 rounded-lg border border-outline-variant px-3 py-1.5 text-center text-xs font-bold text-primary md:mt-2"
          >
            Zur App
          </Link>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible">
          <NavLink to="/admin" end className={navCls}>
            Übersicht
          </NavLink>
          <NavLink to="/admin/users" className={navCls}>
            Nutzer
          </NavLink>
          <NavLink to="/admin/places" className={navCls}>
            Tipps & Orte
          </NavLink>
          <NavLink to="/admin/rides" className={navCls}>
            Mitfahrt
          </NavLink>
          <NavLink to="/admin/vignettes/products" className={navCls}>
            Vignetten
          </NavLink>
          <NavLink to="/admin/vignettes/orders" className={navCls}>
            Vign.-Anfragen
          </NavLink>
          <NavLink to="/admin/payments" className={navCls}>
            Zahlungen
          </NavLink>
          <NavLink to="/admin/radio" className={navCls}>
            Radio
          </NavLink>
          <NavLink to="/admin/promotions" className={navCls}>
            Werbung
          </NavLink>
        </nav>
      </aside>
      <main className="min-h-0 flex-1 overflow-y-auto p-4 pb-16">
        <Routes>
          <Route index element={<AdminDashboardPage />} />
          <Route path="users" element={<AdminUsersPage />} />
          <Route path="places" element={<AdminPlacesPage />} />
          <Route path="rides" element={<AdminRidesPage />} />
          <Route path="vignettes/products" element={<AdminVignetteProductsPage />} />
          <Route path="vignettes/orders" element={<AdminVignetteOrdersPage />} />
          <Route path="payments" element={<AdminPaymentSettingsPage />} />
          <Route path="radio" element={<AdminRadioChannelsPage />} />
          <Route path="promotions" element={<AdminPromotionsPage />} />
        </Routes>
      </main>
    </div>
  )
}
