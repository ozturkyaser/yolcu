import { useCallback, useEffect, useState } from 'react'
import {
  createAdminVignetteProduct,
  deleteAdminVignetteProduct,
  fetchAdminVignetteProducts,
  patchAdminVignetteProduct,
  type VignetteServiceProductDto,
} from '../lib/api'
import { useAuth } from '../context/AuthContext'

const emptyForm = {
  id: '',
  countryCode: 'AT',
  vehicleClass: 'car' as 'car' | 'motorcycle' | 'heavy' | 'other' | 'all',
  kind: 'vignette' as 'vignette' | 'toll' | 'info',
  title: '',
  description: '',
  officialUrl: '',
  partnerCheckoutUrl: '',
  retailHintEur: '',
  serviceFeeEur: '4.99',
  isActive: true,
  sortOrder: '0',
}

export function AdminVignetteProductsPage() {
  const { token } = useAuth()
  const [products, setProducts] = useState<VignetteServiceProductDto[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [modal, setModal] = useState<'create' | 'edit' | null>(null)
  const [editing, setEditing] = useState<VignetteServiceProductDto | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    setErr(null)
    try {
      const { products: rows } = await fetchAdminVignetteProducts(token)
      setProducts(rows)
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

  function openEdit(p: VignetteServiceProductDto) {
    setEditing(p)
    setForm({
      id: p.id,
      countryCode: p.countryCode,
      vehicleClass: p.vehicleClass as typeof form.vehicleClass,
      kind: p.kind as typeof form.kind,
      title: p.title,
      description: p.description,
      officialUrl: p.officialUrl,
      partnerCheckoutUrl: p.partnerCheckoutUrl,
      retailHintEur: p.retailHintEur != null ? String(p.retailHintEur) : '',
      serviceFeeEur: String(p.serviceFeeEur),
      isActive: p.isActive,
      sortOrder: String(p.sortOrder),
    })
    setModal('edit')
  }

  function closeModal() {
    setModal(null)
    setEditing(null)
  }

  async function submitForm() {
    if (!token) return
    const retail =
      form.retailHintEur.trim() === ''
        ? null
        : Number.parseFloat(form.retailHintEur.replace(',', '.'))
    if (form.retailHintEur.trim() !== '' && !Number.isFinite(retail)) {
      setErr('Richtpreis-Hinweis als Zahl oder leer.')
      return
    }
    const fee = Number.parseFloat(form.serviceFeeEur.replace(',', '.'))
    if (!Number.isFinite(fee) || fee < 0) {
      setErr('Servicepauschale als Zahl ≥ 0.')
      return
    }
    const sortOrder = Number.parseInt(form.sortOrder, 10) || 0
    setBusy(true)
    setErr(null)
    try {
      if (modal === 'create') {
        const id = form.id.trim().toLowerCase()
        if (!/^[a-z0-9-]{2,64}$/.test(id)) {
          setErr('ID: nur Kleinbuchstaben, Ziffern, Bindestrich (2–64).')
          setBusy(false)
          return
        }
        await createAdminVignetteProduct(token, {
          id,
          countryCode: form.countryCode.trim().toUpperCase().slice(0, 2),
          vehicleClass: form.vehicleClass,
          kind: form.kind,
          title: form.title.trim(),
          description: form.description.trim(),
          officialUrl: form.officialUrl.trim(),
          partnerCheckoutUrl: form.partnerCheckoutUrl.trim(),
          retailHintEur: retail,
          serviceFeeEur: fee,
          isActive: form.isActive,
          sortOrder,
        })
      } else if (modal === 'edit' && editing) {
        await patchAdminVignetteProduct(token, editing.id, {
          countryCode: form.countryCode.trim().toUpperCase().slice(0, 2),
          vehicleClass: form.vehicleClass,
          kind: form.kind,
          title: form.title.trim(),
          description: form.description.trim(),
          officialUrl: form.officialUrl.trim(),
          partnerCheckoutUrl: form.partnerCheckoutUrl.trim(),
          retailHintEur: retail,
          serviceFeeEur: fee,
          isActive: form.isActive,
          sortOrder,
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
    if (!token || !window.confirm('Produkt wirklich löschen?')) return
    setBusy(true)
    setErr(null)
    try {
      await deleteAdminVignetteProduct(token, id)
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
        <h1 className="text-2xl font-black text-on-surface">Vignetten & Maut (Katalog)</h1>
        <button
          type="button"
          onClick={openCreate}
          className="rounded-xl bg-secondary px-4 py-2 text-sm font-bold text-on-secondary"
        >
          Neues Produkt
        </button>
      </div>
      <p className="text-xs text-on-surface-variant">
        Produkte erscheinen in der Karten-Navigation für Nutzer entlang der Route (passend zu Land und
        Fahrzeugklasse). Servicepauschale ist euer Aufschlag; Richtpreis nur Hinweis für den Kunden.
      </p>
      {err ? <p className="rounded-xl bg-error-container px-3 py-2 text-sm text-on-error-container">{err}</p> : null}
      <ul className="space-y-2">
        {products.map((p) => (
          <li
            key={p.id}
            className="flex flex-col gap-2 rounded-2xl border border-outline-variant/50 bg-surface-container-low p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="font-bold text-on-surface">{p.title}</p>
              <p className="text-[11px] uppercase text-on-surface-variant">
                {p.countryCode} · {p.vehicleClass} · {p.kind} · {p.isActive ? 'aktiv' : 'inaktiv'}
              </p>
              <p className="text-xs text-on-surface-variant">
                Service {p.serviceFeeEur.toFixed(2)} €
                {p.retailHintEur != null ? ` · Richtpreis ca. ${p.retailHintEur.toFixed(2)} €` : ''}
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
            <h2 className="text-lg font-black text-on-surface">
              {modal === 'create' ? 'Neues Produkt' : 'Produkt bearbeiten'}
            </h2>
            <div className="mt-3 grid gap-2">
              {modal === 'create' ? (
                <>
                  <label className="text-[11px] font-bold text-on-surface-variant">ID (slug, z. B. at-car-10d)</label>
                  <input
                    value={form.id}
                    onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
                    className="rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm"
                    maxLength={64}
                  />
                </>
              ) : (
                <p className="text-xs text-on-surface-variant">ID: {editing?.id}</p>
              )}
              <label className="text-[11px] font-bold text-on-surface-variant">Ländercode (ISO-2)</label>
              <input
                value={form.countryCode}
                onChange={(e) => setForm((f) => ({ ...f, countryCode: e.target.value.toUpperCase().slice(0, 2) }))}
                className="rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm"
                maxLength={2}
              />
              <label className="text-[11px] font-bold text-on-surface-variant">Fahrzeugklasse</label>
              <select
                value={form.vehicleClass}
                onChange={(e) =>
                  setForm((f) => ({ ...f, vehicleClass: e.target.value as typeof form.vehicleClass }))
                }
                className="rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm"
              >
                <option value="car">Pkw</option>
                <option value="motorcycle">Motorrad</option>
                <option value="heavy">Schwer / NFZ</option>
                <option value="other">Sonstiges</option>
                <option value="all">Alle</option>
              </select>
              <label className="text-[11px] font-bold text-on-surface-variant">Art</label>
              <select
                value={form.kind}
                onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value as typeof form.kind }))}
                className="rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm"
              >
                <option value="vignette">Vignette</option>
                <option value="toll">Maut</option>
                <option value="info">Info</option>
              </select>
              <label className="text-[11px] font-bold text-on-surface-variant">Titel</label>
              <input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                className="rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm"
                maxLength={200}
              />
              <label className="text-[11px] font-bold text-on-surface-variant">Beschreibung</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="min-h-[4rem] rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm"
                maxLength={2000}
              />
              <label className="text-[11px] font-bold text-on-surface-variant">Offizielle Infoseite (https…)</label>
              <input
                value={form.officialUrl}
                onChange={(e) => setForm((f) => ({ ...f, officialUrl: e.target.value }))}
                className="rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm"
              />
              <label className="text-[11px] font-bold text-on-surface-variant">Partner-Checkout (optional)</label>
              <input
                value={form.partnerCheckoutUrl}
                onChange={(e) => setForm((f) => ({ ...f, partnerCheckoutUrl: e.target.value }))}
                className="rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm"
              />
              <label className="text-[11px] font-bold text-on-surface-variant">Richtpreis-Hinweis EUR (optional)</label>
              <input
                value={form.retailHintEur}
                onChange={(e) => setForm((f) => ({ ...f, retailHintEur: e.target.value }))}
                className="rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm"
                placeholder="z. B. 9.90"
              />
              <label className="text-[11px] font-bold text-on-surface-variant">Servicepauschale EUR</label>
              <input
                value={form.serviceFeeEur}
                onChange={(e) => setForm((f) => ({ ...f, serviceFeeEur: e.target.value }))}
                className="rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm"
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                />
                Aktiv (für Nutzer sichtbar)
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
                disabled={busy || !form.title.trim() || (modal === 'create' && !form.id.trim())}
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
