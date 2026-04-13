import { useState, type FormEvent } from 'react'
import { createPoi, type MapPoiDto } from '../lib/api'
import { useAuth } from '../context/AuthContext'

const categories = [
  { value: 'hotel', label: 'Hotel' },
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'parking', label: 'Parken' },
  { value: 'border', label: 'Grenze' },
  { value: 'fuel', label: 'Tanken' },
  { value: 'rest', label: 'Rast' },
  { value: 'mosque', label: 'Gebet / Mescit' },
  { value: 'help', label: 'Hilfe' },
  { value: 'other', label: 'Sonstiges' },
] as const

type Props = {
  open: boolean
  onClose: () => void
  lat: number
  lng: number
  onCreated: (poi: MapPoiDto) => void
}

export function CreatePoiModal({ open, onClose, lat, lng, onCreated }: Props) {
  const { token } = useAuth()
  const [name, setName] = useState('')
  const [category, setCategory] = useState<string>('restaurant')
  const [note, setNote] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  if (!open) return null

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!token) return
    setErr(null)
    setSending(true)
    try {
      const { poi } = await createPoi(token, {
        name: name.trim(),
        lat,
        lng,
        category,
        note: note.trim() || undefined,
      })
      onCreated(poi)
      setName('')
      setNote('')
      onClose()
    } catch (er) {
      setErr(er instanceof Error ? er.message : 'Speichern fehlgeschlagen')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="poi-title"
        className="w-full max-w-md rounded-3xl bg-surface-container-lowest p-6 shadow-2xl"
      >
        <h2 id="poi-title" className="mb-4 text-xl font-bold text-on-surface">
          Ort auf der Karte
        </h2>
        <p className="mb-4 text-sm text-on-surface-variant">
          Position: {lat.toFixed(4)}, {lng.toFixed(4)}
        </p>
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-on-surface">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={200}
              className="mt-1 w-full rounded-2xl border border-outline-variant bg-surface px-4 py-3 text-on-surface"
              placeholder={
                category === 'hotel'
                  ? 'z. B. Hotel an der A4'
                  : category === 'restaurant'
                    ? 'z. B. Lokanta / Imbiss Name'
                    : 'z. B. Rastplatz XY'
              }
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-on-surface">Kategorie</span>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1 w-full rounded-2xl border border-outline-variant bg-surface px-4 py-3 text-on-surface"
            >
              {categories.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-on-surface">Notiz (optional)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={2}
              className="mt-1 w-full rounded-2xl border border-outline-variant bg-surface px-4 py-3 text-on-surface"
            />
          </label>
          {err ? <p className="text-sm text-error">{err}</p> : null}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-2xl border border-outline-variant py-3 font-semibold text-on-surface"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={sending || !name.trim()}
              className="flex-1 rounded-2xl bg-primary py-3 font-semibold text-on-primary disabled:opacity-50"
            >
              {sending ? '…' : 'Speichern'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
