import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch, type VehicleDto } from '../lib/api'
import { MAP_MAP_ICON_OPTIONS, normalizeMapIconId, type MapMapIconId } from '../lib/mapIcons'
import { useAuth } from '../context/AuthContext'

export function ProfilePage() {
  const { token, user, loading: authLoading, logout, refreshMe } = useAuth()
  const [vehicles, setVehicles] = useState<VehicleDto[]>([])
  const [displayName, setDisplayName] = useState('')
  const [mapIcon, setMapIcon] = useState<MapMapIconId>('person')
  const [vLabel, setVLabel] = useState('')
  const [vPlate, setVPlate] = useState('')
  const [vTrailer, setVTrailer] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setLoading(false)
      return
    }
    void (async () => {
      try {
        const data = await apiFetch<{ user: typeof user; vehicles: VehicleDto[] }>('/profile', { token })
        if (data.user) {
          setDisplayName(data.user.displayName)
          setMapIcon(normalizeMapIconId(data.user.mapIcon))
        }
        setVehicles(data.vehicles)
        const primary = data.vehicles.find((x) => x.is_primary) ?? data.vehicles[0]
        if (primary) {
          setVLabel(primary.label)
          setVPlate(primary.plate)
          setVTrailer(primary.trailer_mode)
        }
      } catch {
        setMsg('Profil konnte nicht geladen werden.')
      } finally {
        setLoading(false)
      }
    })()
  }, [token])

  if (authLoading || (token && loading)) {
    return (
      <main className="flex min-h-[40dvh] items-center justify-center text-on-surface-variant">Laden…</main>
    )
  }

  if (!token || !user) {
    return (
      <main className="mx-auto max-w-md px-6 py-16 text-center">
        <p className="mb-6 text-on-surface-variant">Bitte anmelden, um dein Profil zu sehen.</p>
        <Link
          to="/login"
          className="inline-block rounded-xl bg-primary px-8 py-3 font-bold text-on-primary"
        >
          Anmelden
        </Link>
      </main>
    )
  }

  async function saveProfile() {
    if (!token) return
    setSaving(true)
    setMsg(null)
    try {
      const nameForApi = displayName.trim() || user.displayName
      await apiFetch('/profile', {
        method: 'PUT',
        token,
        body: JSON.stringify({ displayName: nameForApi, mapIcon }),
      })
      const vid = vehicles.find((x) => x.is_primary)?.id ?? vehicles[0]?.id
      if (vid) {
        await apiFetch(`/vehicles/${vid}`, {
          method: 'PUT',
          token,
          body: JSON.stringify({ label: vLabel, plate: vPlate, trailerMode: vTrailer }),
        })
      } else if (vLabel || vPlate) {
        const r = await apiFetch<{ vehicle: VehicleDto }>('/vehicles', {
          method: 'POST',
          token,
          body: JSON.stringify({ label: vLabel, plate: vPlate, trailerMode: vTrailer }),
        })
        setVehicles([r.vehicle])
      }
      setMsg('Gespeichert.')
      await refreshMe()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Fehler')
    } finally {
      setSaving(false)
    }
  }

  const primary = vehicles.find((x) => x.is_primary) ?? vehicles[0]

  return (
    <main className="mx-auto max-w-4xl px-6 pb-28 pt-2">
      {msg ? (
        <div className="mb-4 rounded-xl bg-surface-container-low p-3 text-sm font-medium text-on-surface">{msg}</div>
      ) : null}

      <section className="mb-12 grid grid-cols-1 gap-6 md:grid-cols-12">
        <div className="flex flex-col items-center md:col-span-4 md:items-start">
          <div className="mb-4 flex h-32 w-32 items-center justify-center overflow-hidden rounded-full bg-primary-container text-4xl font-black text-on-primary ring-4 ring-primary-container shadow-2xl">
            {user.displayName.slice(0, 1).toUpperCase()}
          </div>
          <h2 className="font-sans text-2xl font-extrabold tracking-tight">{user.displayName}</h2>
          <p className="font-sans text-xs uppercase tracking-widest text-on-surface-variant">{user.email}</p>
          <button
            type="button"
            onClick={logout}
            className="mt-4 text-sm font-bold text-error"
          >
            Abmelden
          </button>
        </div>
        <div className="grid grid-cols-2 gap-4 md:col-span-8">
          <div className="flex flex-col justify-center rounded-xl bg-surface-container-low p-6">
            <span className="mb-1 font-sans text-[0.75rem] font-medium uppercase tracking-wide text-on-surface-variant">
              Toplam Mesafe
            </span>
            <span className="font-sans text-4xl font-bold text-primary">
              {user.statsKm.toLocaleString('de-DE')}
              <span className="ml-1 text-xl font-medium">km</span>
            </span>
          </div>
          <div className="flex flex-col justify-center rounded-xl bg-surface-container-low p-6">
            <span className="mb-1 font-sans text-[0.75rem] font-medium uppercase tracking-wide text-on-surface-variant">
              Keşfedilen Bölge
            </span>
            <span className="font-sans text-4xl font-bold text-primary">
              {user.statsRegions}
              <span className="ml-1 text-xl font-medium">Bölge</span>
            </span>
          </div>
        </div>
      </section>

      <section className="mb-8 rounded-2xl bg-surface-container-low p-6">
        <h3 className="mb-4 font-sans text-lg font-bold text-primary">Profil bearbeiten</h3>
        <label className="mb-1 block text-xs font-bold uppercase text-on-surface-variant">Anzeigename</label>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="mb-6 w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-3 py-2"
        />
        <p className="mb-2 text-xs font-bold uppercase text-on-surface-variant">Icon auf der Karte</p>
        <p className="mb-3 text-xs text-on-surface-variant">
          So erscheinst du anderen, die die Karte nutzen (wenn du deine Position teilst).
        </p>
        <div className="mb-4 grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
          {MAP_MAP_ICON_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              title={opt.label}
              onClick={() => setMapIcon(opt.id)}
              className={
                mapIcon === opt.id
                  ? 'flex aspect-square items-center justify-center rounded-xl bg-primary text-on-primary ring-2 ring-amber-400'
                  : 'flex aspect-square items-center justify-center rounded-xl border border-outline-variant/40 bg-surface-container-lowest text-on-surface hover:bg-surface-container-high'
              }
            >
              <span className="material-symbols-outlined text-2xl" style={{ fontVariationSettings: "'FILL' 1" }}>
                {opt.id}
              </span>
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={() => void saveProfile()}
          className="rounded-xl bg-primary px-6 py-2 font-bold text-on-primary disabled:opacity-50"
        >
          {saving ? '…' : 'Speichern'}
        </button>
      </section>

      <section className="mb-12">
        <div className="mb-6 flex items-center justify-between">
          <h3 className="font-sans text-xl font-bold uppercase tracking-tighter">Fahrzeug</h3>
          {primary ? (
            <span className="rounded-full bg-primary/10 px-3 py-1 font-sans text-xs font-bold text-primary">
              Aktiv
            </span>
          ) : null}
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="rounded-xl bg-surface-container-low p-6">
            <label className="mb-1 block text-xs font-bold uppercase text-on-surface-variant">Bezeichnung</label>
            <input
              value={vLabel}
              onChange={(e) => setVLabel(e.target.value)}
              placeholder="z. B. Volvo XC90"
              className="mb-4 w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-3 py-2"
            />
            <label className="mb-1 block text-xs font-bold uppercase text-on-surface-variant">Kennzeichen</label>
            <input
              value={vPlate}
              onChange={(e) => setVPlate(e.target.value)}
              className="mb-4 w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-3 py-2"
            />
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={vTrailer}
                onChange={(e) => setVTrailer(e.target.checked)}
              />
              Römork / Anhänger-Modus
            </label>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-sans text-xl font-bold uppercase tracking-tighter">VİNYET KONTROL LİSTESİ</h3>
          <Link to="/legal/privacy" className="text-xs font-bold text-primary">
            Datenschutz
          </Link>
        </div>
        <div className="overflow-hidden rounded-xl bg-surface-container-low">
          {['Austria', 'Hungary', 'Slovenia', 'Bulgaria', 'Türkiye'].map((c, i) => (
            <div
              key={c}
              className={`flex items-center justify-between px-6 py-5 ${i > 0 ? 'border-t border-outline-variant/10' : ''} ${i === 0 ? 'bg-white shadow-sm' : ''}`}
            >
              <span className="font-sans text-lg font-semibold">{c}</span>
              <span className="font-sans text-xs font-bold text-primary">Prüfen / kaufen ↗</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
