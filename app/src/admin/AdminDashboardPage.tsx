import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchAdminStats } from '../lib/api'
import { useAuth } from '../context/AuthContext'

export function AdminDashboardPage() {
  const { token } = useAuth()
  const [stats, setStats] = useState<{
    users: number
    posts: number
    curatedPlaces: number
    rideListings: number
    rideRequests: number
    vignetteProducts?: number
    vignetteOrders?: number
  } | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    void (async () => {
      try {
        const { stats: s } = await fetchAdminStats(token)
        setStats(s)
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Statistik fehlgeschlagen')
      }
    })()
  }, [token])

  const cards = stats
    ? [
        { label: 'Nutzer', value: stats.users, to: '/admin/users' },
        { label: 'Community-Posts', value: stats.posts, to: '/community' },
        { label: 'Kuratierte Orte', value: stats.curatedPlaces, to: '/admin/places' },
        { label: 'Mitfahrt-Angebote', value: stats.rideListings, to: '/admin/rides' },
        { label: 'Mitfahrt-Anfragen', value: stats.rideRequests, to: '/admin/rides' },
        { label: 'Vignetten-Produkte', value: stats.vignetteProducts ?? 0, to: '/admin/vignettes/products' },
        { label: 'Vignetten-Bestellungen', value: stats.vignetteOrders ?? 0, to: '/admin/vignettes/orders' },
      ]
    : []

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="text-2xl font-black text-on-surface">Übersicht</h1>
        <p className="mt-1 text-sm text-on-surface-variant">
          Zentrale Verwaltung: Nutzer, redaktionelle Karten-Tipps (Unterkunft, Restaurant, Rasthof) und
          Mitfahrt-Marktplatz.
        </p>
      </header>
      {err ? <p className="rounded-xl bg-error-container px-3 py-2 text-sm text-on-error-container">{err}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Link
            key={c.label}
            to={c.to}
            className="rounded-2xl border border-outline-variant/50 bg-surface-container-low p-4 shadow-sm transition hover:border-primary/40"
          >
            <p className="text-xs font-bold uppercase tracking-wide text-on-surface-variant">{c.label}</p>
            <p className="mt-2 font-sans text-3xl font-black text-primary">{c.value}</p>
          </Link>
        ))}
      </div>
      <section className="rounded-2xl border border-outline-variant/40 bg-surface-container-lowest p-4">
        <h2 className="text-sm font-black text-on-surface">Hinweis</h2>
        <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">
          Standard-Admin nach lokalem Seed: Nutzer <strong>test@yol.local</strong> (siehe README). In Produktion
          Rollen nur vertrauenswürdigen Personen zuweisen. Es gibt noch kein separates Admin-Login – Zugriff über
          normales Konto mit Rolle „admin“.
        </p>
      </section>
    </div>
  )
}
