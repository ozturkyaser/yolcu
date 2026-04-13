import { useEffect, useState } from 'react'
import { apiFetch, type PostDto } from '../lib/api'
import { useAuth } from '../context/AuthContext'

type Props = {
  open: boolean
  onClose: () => void
  onCreated: (post: PostDto) => void
  defaultCategory?: 'general' | 'traffic' | 'border' | 'help'
}

export function CreatePostModal({ open, onClose, onCreated, defaultCategory = 'general' }: Props) {
  const { token } = useAuth()
  const [body, setBody] = useState('')
  const [category, setCategory] = useState(defaultCategory)
  const [locationLabel, setLocationLabel] = useState('')
  const [expiresInHours, setExpiresInHours] = useState<number | ''>('')
  const [borderWaitMinutes, setBorderWaitMinutes] = useState<number | ''>('')
  const [borderSlug, setBorderSlug] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setCategory(defaultCategory)
      setError(null)
    }
  }, [open, defaultCategory])

  if (!open) return null

  async function submit() {
    if (!token) return
    setError(null)
    setBusy(true)
    try {
      const payload: Record<string, unknown> = {
        body,
        category,
        locationLabel: locationLabel || undefined,
      }
      if (expiresInHours !== '' && typeof expiresInHours === 'number') {
        payload.expiresInHours = expiresInHours
      }
      if (category === 'border') {
        if (borderWaitMinutes !== '' && typeof borderWaitMinutes === 'number') {
          payload.borderWaitMinutes = borderWaitMinutes
        }
        if (borderSlug.trim()) payload.borderSlug = borderSlug.trim().toLowerCase()
      }
      const data = await apiFetch<{ post: PostDto }>('/posts', {
        method: 'POST',
        token,
        body: JSON.stringify(payload),
      })
      onCreated(data.post)
      setBody('')
      setLocationLabel('')
      setExpiresInHours('')
      setBorderWaitMinutes('')
      setBorderSlug('')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-3xl bg-surface-container-lowest p-6 shadow-2xl">
        <h2 className="mb-4 text-xl font-black text-primary">Meldung erstellen</h2>
        {error ? (
          <p className="mb-4 rounded-xl bg-error-container p-3 text-sm text-on-error-container">{error}</p>
        ) : null}

        <label className="mb-1 block text-xs font-bold uppercase text-on-surface-variant">Kategorie</label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as typeof category)}
          className="mb-4 w-full rounded-xl border border-outline-variant/30 bg-surface px-3 py-3"
        >
          <option value="general">Allgemein</option>
          <option value="traffic">Trafik</option>
          <option value="border">Sınır</option>
          <option value="help">Yardım</option>
        </select>

        <label className="mb-1 block text-xs font-bold uppercase text-on-surface-variant">Text</label>
        <textarea
          required
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          maxLength={2000}
          className="mb-4 w-full rounded-xl border border-outline-variant/30 bg-surface px-3 py-2"
        />

        <label className="mb-1 block text-xs font-bold uppercase text-on-surface-variant">
          Ort (optional)
        </label>
        <input
          value={locationLabel}
          onChange={(e) => setLocationLabel(e.target.value)}
          className="mb-4 w-full rounded-xl border border-outline-variant/30 bg-surface px-3 py-2"
        />

        {category === 'border' ? (
          <>
            <label className="mb-1 block text-xs font-bold uppercase text-on-surface-variant">
              Wartezeit (Min., optional)
            </label>
            <input
              type="number"
              min={0}
              max={1440}
              value={borderWaitMinutes}
              onChange={(e) =>
                setBorderWaitMinutes(e.target.value === '' ? '' : Number(e.target.value))
              }
              className="mb-3 w-full rounded-xl border border-outline-variant/30 bg-surface px-3 py-2"
              placeholder="z. B. 45"
            />
            <label className="mb-1 block text-xs font-bold uppercase text-on-surface-variant">
              Grenz-Seite (Slug, optional)
            </label>
            <input
              value={borderSlug}
              onChange={(e) => setBorderSlug(e.target.value)}
              className="mb-4 w-full rounded-xl border border-outline-variant/30 bg-surface px-3 py-2 font-mono text-sm"
              placeholder="z. B. horgos"
            />
          </>
        ) : null}

        <label className="mb-1 block text-xs font-bold uppercase text-on-surface-variant">
          Ablauf in Stunden (optional)
        </label>
        <input
          type="number"
          min={1}
          max={168}
          value={expiresInHours}
          onChange={(e) => setExpiresInHours(e.target.value === '' ? '' : Number(e.target.value))}
          className="mb-6 w-full rounded-xl border border-outline-variant/30 bg-surface px-3 py-2"
        />

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl bg-surface-container-high py-3 font-bold"
          >
            Abbrechen
          </button>
          <button
            type="button"
            disabled={busy || !body.trim()}
            onClick={() => void submit()}
            className="flex-1 rounded-xl bg-primary py-3 font-bold text-on-primary disabled:opacity-50"
          >
            {busy ? '…' : 'Senden'}
          </button>
        </div>
      </div>
    </div>
  )
}
