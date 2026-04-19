import { useCallback, useEffect, useState } from 'react'
import {
  createAdminCuratedPlace,
  deleteAdminCuratedPlace,
  fetchAdminCuratedPlaces,
  patchAdminCuratedPlace,
  type CuratedPlaceCategory,
  type CuratedPlaceDto,
  type SilaRouteCodeFilter,
} from '../lib/api'
import { useAuth } from '../context/AuthContext'

const emptyForm = {
  category: 'restaurant' as CuratedPlaceCategory,
  name: '',
  description: '',
  lat: '52.52',
  lng: '13.405',
  address: '',
  region: '',
  phone: '',
  website: '',
  imageUrl: '',
  isPublished: true,
  sortOrder: '0',
  /** leer = alle Routen (NULL in DB) */
  routeCode: '' as '' | SilaRouteCodeFilter,
}

export function AdminPlacesPage() {
  const { token } = useAuth()
  const [places, setPlaces] = useState<CuratedPlaceDto[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [modal, setModal] = useState<'create' | 'edit' | null>(null)
  const [editing, setEditing] = useState<CuratedPlaceDto | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    setErr(null)
    try {
      const { places: rows } = await fetchAdminCuratedPlaces(token)
      setPlaces(rows)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Laden fehlgeschlagen')
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  function openCreate() {
    setEditing(null)
    setForm({ ...emptyForm })
    setModal('create')
  }

  function openEdit(p: CuratedPlaceDto) {
    setEditing(p)
    setForm({
      category: p.category,
      name: p.name,
      description: p.description,
      lat: String(p.lat),
      lng: String(p.lng),
      address: p.address,
      region: p.region,
      phone: p.phone,
      website: p.website,
      imageUrl: p.imageUrl,
      isPublished: p.isPublished,
      sortOrder: String(p.sortOrder),
      routeCode: (p.routeCode ?? '') as '' | SilaRouteCodeFilter,
    })
    setModal('edit')
  }

  function closeModal() {
    setModal(null)
    setEditing(null)
  }

  async function submitForm() {
    if (!token) return
    const lat = parseFloat(form.lat.replace(',', '.'))
    const lng = parseFloat(form.lng.replace(',', '.'))
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setErr('Breite/Länge als Zahl eingeben.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      if (modal === 'create') {
        await createAdminCuratedPlace(token, {
          category: form.category,
          name: form.name.trim(),
          description: form.description.trim(),
          lat,
          lng,
          address: form.address.trim(),
          region: form.region.trim(),
          phone: form.phone.trim(),
          website: form.website.trim(),
          imageUrl: form.imageUrl.trim(),
          isPublished: form.isPublished,
          sortOrder: parseInt(form.sortOrder, 10) || 0,
          routeCode: form.routeCode ? form.routeCode : null,
        })
      } else if (modal === 'edit' && editing) {
        await patchAdminCuratedPlace(token, editing.id, {
          category: form.category,
          name: form.name.trim(),
          description: form.description.trim(),
          lat,
          lng,
          address: form.address.trim(),
          region: form.region.trim(),
          phone: form.phone.trim(),
          website: form.website.trim(),
          imageUrl: form.imageUrl.trim(),
          isPublished: form.isPublished,
          sortOrder: parseInt(form.sortOrder, 10) || 0,
          routeCode: form.routeCode ? form.routeCode : null,
        })
      }
      closeModal()
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Speichern fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    if (!token || !window.confirm('Eintrag wirklich löschen?')) return
    setBusy(true)
    setErr(null)
    try {
      await deleteAdminCuratedPlace(token, id)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Löschen fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-black text-on-surface">Tipps & Orte</h1>
        <button
          type="button"
          onClick={openCreate}
          className="rounded-xl bg-secondary px-4 py-2 text-sm font-bold text-on-secondary"
        >
          Neuer Eintrag
        </button>
      </div>
      <p className="text-xs text-on-surface-variant">
        Kuratierte Tipps zur Sıla-Route: Kategorien inkl. Werkstatt und Grenze; optional Routencode (Nord/West/Süd/Balkan),
        damit Marker nur für die gewählte Variante erscheinen.
      </p>
      {err ? <p className="rounded-xl bg-error-container px-3 py-2 text-sm text-on-error-container">{err}</p> : null}
      <ul className="space-y-2">
        {places.map((p) => (
          <li
            key={p.id}
            className="flex flex-col gap-2 rounded-2xl border border-outline-variant/50 bg-surface-container-low p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p className="font-bold text-on-surface">{p.name}</p>
              <p className="text-[11px] uppercase text-on-surface-variant">
                {p.category}
                {p.routeCode ? ` · ${p.routeCode}` : ''} · {p.isPublished ? 'veröffentlicht' : 'Entwurf'}
              </p>
              <p className="text-xs text-on-surface-variant">
                {p.lat.toFixed(4)}, {p.lng.toFixed(4)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => openEdit(p)}
                className="rounded-lg border border-outline-variant px-3 py-1.5 text-xs font-bold"
              >
                Bearbeiten
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void remove(p.id)}
                className="rounded-lg bg-error-container px-3 py-1.5 text-xs font-bold text-on-error-container"
              >
                Löschen
              </button>
            </div>
          </li>
        ))}
      </ul>

      {modal ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-3 sm:items-center">
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-outline-variant bg-surface-container-lowest p-4 shadow-xl">
            <h2 className="text-lg font-black text-on-surface">{modal === 'create' ? 'Neuer Ort' : 'Ort bearbeiten'}</h2>
            <div className="mt-3 grid gap-2">
              <label className="text-[11px] font-bold text-on-surface-variant">Kategorie</label>
              <select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as CuratedPlaceCategory }))}
                className="rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm"
              >
                <option value="accommodation">Unterkunft</option>
                <option value="restaurant">Restaurant</option>
                <option value="rest_area">Rasthof / Pause</option>
                <option value="workshop">Werkstatt</option>
                <option value="border">Grenze / Kontrollpunkt</option>
              </select>
              <label className="text-[11px] font-bold text-on-surface-variant">Routen-Variante (optional)</label>
              <select
                value={form.routeCode}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    routeCode: e.target.value as '' | SilaRouteCodeFilter,
                  }))
                }
                className="rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm"
              >
                <option value="">Alle / nicht zugeordnet</option>
                <option value="A_NORTH">A · Nord</option>
                <option value="B_WEST">B · West</option>
                <option value="C_SOUTH">C · Süd</option>
                <option value="COMMON">Balkan-Kern (ab Belgrad)</option>
              </select>
              <label className="text-[11px] font-bold text-on-surface-variant">Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm"
                maxLength={200}
              />
              <label className="text-[11px] font-bold text-on-surface-variant">Beschreibung</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="min-h-[5rem] rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm"
                maxLength={4000}
              />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-bold text-on-surface-variant">Breite</label>
                  <input
                    value={form.lat}
                    onChange={(e) => setForm((f) => ({ ...f, lat: e.target.value }))}
                    className="w-full rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-on-surface-variant">Länge</label>
                  <input
                    value={form.lng}
                    onChange={(e) => setForm((f) => ({ ...f, lng: e.target.value }))}
                    className="w-full rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <label className="text-[11px] font-bold text-on-surface-variant">Adresse</label>
              <input
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                className="rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm"
              />
              <label className="text-[11px] font-bold text-on-surface-variant">Region / Ort</label>
              <input
                value={form.region}
                onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))}
                className="rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm"
              />
              <label className="text-[11px] font-bold text-on-surface-variant">Telefon</label>
              <input
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm"
              />
              <label className="text-[11px] font-bold text-on-surface-variant">Web (https…)</label>
              <input
                value={form.website}
                onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
                className="rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm"
              />
              <label className="text-[11px] font-bold text-on-surface-variant">Bild-URL (https…)</label>
              <input
                value={form.imageUrl}
                onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
                className="rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm"
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.isPublished}
                  onChange={(e) => setForm((f) => ({ ...f, isPublished: e.target.checked }))}
                />
                Veröffentlicht (auf Karte sichtbar)
              </label>
              <label className="text-[11px] font-bold text-on-surface-variant">Sortierung (höher = weiter oben)</label>
              <input
                value={form.sortOrder}
                onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
                className="rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={closeModal} className="rounded-xl border border-outline-variant px-4 py-2 text-sm font-bold">
                Abbrechen
              </button>
              <button
                type="button"
                disabled={busy || !form.name.trim()}
                onClick={() => void submitForm()}
                className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-on-primary disabled:opacity-40"
              >
                {busy ? '…' : 'Speichern'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
