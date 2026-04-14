import { useCallback, useEffect, useState } from 'react'
import { fetchAdminRideListings, patchAdminRideListing, type AdminRideListingRow } from '../lib/api'
import { useAuth } from '../context/AuthContext'

export function AdminRidesPage() {
  const { token } = useAuth()
  const [listings, setListings] = useState<AdminRideListingRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    setErr(null)
    try {
      const { listings: rows } = await fetchAdminRideListings(token)
      setListings(rows)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Laden fehlgeschlagen')
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  async function setStatus(id: string, status: 'open' | 'closed') {
    if (!token) return
    setBusy(id)
    setErr(null)
    try {
      await patchAdminRideListing(token, id, { status })
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Speichern fehlgeschlagen')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-black text-on-surface">Mitfahrt-Marktplatz</h1>
        <button type="button" onClick={() => void load()} className="rounded-xl bg-primary px-3 py-2 text-xs font-bold text-on-primary">
          Aktualisieren
        </button>
      </div>
      {err ? <p className="rounded-xl bg-error-container px-3 py-2 text-sm text-on-error-container">{err}</p> : null}
      <ul className="space-y-2">
        {listings.map((l) => (
          <li
            key={l.id}
            className="rounded-2xl border border-outline-variant/50 bg-surface-container-low p-3 text-sm"
          >
            <p className="font-bold text-on-surface">
              {l.routeFrom} → {l.routeTo}
            </p>
            <p className="text-xs text-on-surface-variant">
              {l.offerKind} · {l.status} · {l.ownerName} ({l.ownerEmail})
            </p>
            <p className="text-[10px] text-on-surface-variant">{new Date(l.createdAt).toLocaleString('de-DE')}</p>
            <div className="mt-2 flex gap-2">
              {l.status === 'open' ? (
                <button
                  type="button"
                  disabled={busy === l.id}
                  onClick={() => void setStatus(l.id, 'closed')}
                  className="rounded-lg border border-outline-variant px-2 py-1 text-[11px] font-bold"
                >
                  Schließen
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy === l.id}
                  onClick={() => void setStatus(l.id, 'open')}
                  className="rounded-lg bg-secondary-container px-2 py-1 text-[11px] font-bold text-on-secondary-container"
                >
                  Wieder öffnen
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
