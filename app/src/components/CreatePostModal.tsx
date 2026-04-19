import { useEffect, useRef, useState } from 'react'
import { apiFetch, createPostWithMedia, type PostDto } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../i18n/I18nContext'

type Props = {
  open: boolean
  onClose: () => void
  onCreated: (post: PostDto) => void
  defaultCategory?: 'general' | 'traffic' | 'border' | 'help'
}

export function CreatePostModal({ open, onClose, onCreated, defaultCategory = 'general' }: Props) {
  const { token } = useAuth()
  const { t } = useI18n()
  const [body, setBody] = useState('')
  const [category, setCategory] = useState(defaultCategory)
  const [locationLabel, setLocationLabel] = useState('')
  const [expiresInHours, setExpiresInHours] = useState<number | ''>('')
  const [borderWaitMinutes, setBorderWaitMinutes] = useState<number | ''>('')
  const [borderSlug, setBorderSlug] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setCategory(defaultCategory)
      setError(null)
    }
  }, [open, defaultCategory])

  useEffect(() => {
    if (!file) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  if (!open) return null

  const canSubmit = Boolean((body.trim().length >= 1 || file) && (file || body.trim().length >= 1))

  async function submit() {
    if (!token || !canSubmit) return
    setError(null)
    setBusy(true)
    try {
      if (file) {
        const fd = new FormData()
        fd.append('category', category)
        fd.append('body', body.trim())
        if (locationLabel.trim()) fd.append('locationLabel', locationLabel.trim())
        if (expiresInHours !== '' && typeof expiresInHours === 'number') {
          fd.append('expiresInHours', String(expiresInHours))
        }
        if (category === 'border') {
          if (borderWaitMinutes !== '' && typeof borderWaitMinutes === 'number') {
            fd.append('borderWaitMinutes', String(borderWaitMinutes))
          }
          if (borderSlug.trim()) fd.append('borderSlug', borderSlug.trim().toLowerCase())
        }
        fd.append('media', file)
        const data = await createPostWithMedia(token, fd)
        onCreated(data.post)
      } else {
        const payload: Record<string, unknown> = {
          body: body.trim(),
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
      }
      setBody('')
      setLocationLabel('')
      setExpiresInHours('')
      setBorderWaitMinutes('')
      setBorderSlug('')
      setFile(null)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[100dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[1.25rem] bg-surface sm:max-h-[90dvh] sm:rounded-2xl sm:shadow-2xl">
        <header className="flex shrink-0 items-center justify-between border-b border-outline-variant/40 px-3 py-2.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm font-bold text-on-surface-variant"
          >
            {t('community_create_cancel')}
          </button>
          <h2 className="text-sm font-black tracking-tight text-on-surface">{t('community_create_title')}</h2>
          <button
            type="button"
            disabled={busy || !canSubmit}
            onClick={() => void submit()}
            className="rounded-lg px-2 py-1 text-sm font-black text-primary disabled:opacity-40"
          >
            {busy ? '…' : t('community_create_share')}
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error ? (
            <p className="mx-3 mt-3 rounded-xl bg-error-container px-3 py-2 text-sm text-on-error-container">{error}</p>
          ) : null}

          <div className="relative mx-auto aspect-square w-full max-w-lg bg-black/5">
            {preview ? (
              file?.type.startsWith('video/') ? (
                <video src={preview} className="h-full w-full object-cover" controls muted playsInline />
              ) : (
                <img src={preview} alt="" className="h-full w-full object-cover" />
              )
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex h-full w-full flex-col items-center justify-center gap-3 text-on-surface-variant"
              >
                <span className="material-symbols-outlined text-5xl text-primary/80">add_photo_alternate</span>
                <span className="text-sm font-semibold">{t('community_create_pick_media')}</span>
                <span className="max-w-[14rem] text-center text-xs opacity-80">{t('community_create_pick_hint')}</span>
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                setFile(f ?? null)
                e.target.value = ''
              }}
            />
            {preview ? (
              <button
                type="button"
                onClick={() => setFile(null)}
                className="absolute top-2 right-2 rounded-full bg-black/50 px-2 py-1 text-xs font-bold text-white"
              >
                {t('community_create_remove_media')}
              </button>
            ) : null}
          </div>

          <div className="space-y-3 px-4 py-4">
            <label className="block">
              <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">
                {t('community_create_caption')}
              </span>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder={t('community_create_caption_ph')}
                className="w-full resize-none rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-3 py-2 text-sm"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">
                {t('community_create_category')}
              </span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as typeof category)}
                className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-3 py-2.5 text-sm font-semibold"
              >
                <option value="general">{t('community_cat_general')}</option>
                <option value="traffic">{t('community_cat_traffic')}</option>
                <option value="border">{t('community_cat_border')}</option>
                <option value="help">{t('community_cat_help')}</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">
                {t('community_create_location')}
              </span>
              <input
                value={locationLabel}
                onChange={(e) => setLocationLabel(e.target.value)}
                className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-3 py-2 text-sm"
              />
            </label>

            {category === 'border' ? (
              <>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">
                    {t('community_create_border_wait')}
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    value={borderWaitMinutes}
                    onChange={(e) =>
                      setBorderWaitMinutes(e.target.value === '' ? '' : Number(e.target.value))
                    }
                    className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-3 py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">
                    {t('community_create_border_slug')}
                  </span>
                  <input
                    value={borderSlug}
                    onChange={(e) => setBorderSlug(e.target.value)}
                    className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-3 py-2 font-mono text-sm"
                  />
                </label>
              </>
            ) : null}

            <label className="block">
              <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">
                {t('community_create_expires')}
              </span>
              <input
                type="number"
                min={1}
                max={168}
                value={expiresInHours}
                onChange={(e) => setExpiresInHours(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full rounded-xl border border-outline-variant/30 bg-surface-container-lowest px-3 py-2 text-sm"
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}
