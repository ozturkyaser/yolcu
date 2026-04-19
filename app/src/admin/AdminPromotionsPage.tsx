import { useCallback, useEffect, useState } from 'react'
import {
  createAdminPromotion,
  deleteAdminPromotion,
  fetchAdminPromotions,
  patchAdminPromotion,
  type PromotionCampaignAdminDto,
} from '../lib/api'
import { useAuth } from '../context/AuthContext'

function isoToDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function datetimeLocalToIso(v: string): string {
  const d = new Date(v)
  return d.toISOString()
}

const emptyForm = {
  internalName: '',
  headlineDe: '',
  headlineTr: '',
  headlineEn: '',
  bodyDe: '',
  bodyTr: '',
  bodyEn: '',
  imageUrl: '',
  ctaLabelDe: '',
  ctaLabelTr: '',
  ctaLabelEn: '',
  ctaUrl: 'https://',
  startsAtLocal: '',
  endsAtLocal: '',
  isActive: true,
  priority: '0',
}

type FormState = typeof emptyForm

export function AdminPromotionsPage() {
  const { token } = useAuth()
  const [rows, setRows] = useState<PromotionCampaignAdminDto[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [modal, setModal] = useState<'create' | 'edit' | null>(null)
  const [editing, setEditing] = useState<PromotionCampaignAdminDto | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    setErr(null)
    try {
      const { campaigns } = await fetchAdminPromotions(token)
      setRows(campaigns)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Laden fehlgeschlagen')
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  function openCreate() {
    setEditing(null)
    const now = new Date()
    const in7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    setForm({
      ...emptyForm,
      startsAtLocal: isoToDatetimeLocal(now.toISOString()),
      endsAtLocal: isoToDatetimeLocal(in7.toISOString()),
    })
    setModal('create')
  }

  function openEdit(p: PromotionCampaignAdminDto) {
    setEditing(p)
    setForm({
      internalName: p.internalName,
      headlineDe: p.headlineDe,
      headlineTr: p.headlineTr,
      headlineEn: p.headlineEn,
      bodyDe: p.bodyDe,
      bodyTr: p.bodyTr,
      bodyEn: p.bodyEn,
      imageUrl: p.imageUrl,
      ctaLabelDe: p.ctaLabelDe,
      ctaLabelTr: p.ctaLabelTr,
      ctaLabelEn: p.ctaLabelEn,
      ctaUrl: p.ctaUrl,
      startsAtLocal: isoToDatetimeLocal(p.startsAt),
      endsAtLocal: isoToDatetimeLocal(p.endsAt),
      isActive: p.isActive,
      priority: String(p.priority),
    })
    setModal('edit')
  }

  function closeModal() {
    setModal(null)
    setEditing(null)
  }

  async function submitForm() {
    if (!token) return
    const pr = parseInt(form.priority, 10)
    if (!Number.isFinite(pr)) {
      setErr('Priorität als Ganzzahl.')
      return
    }
    if (!form.internalName.trim() || !form.ctaUrl.trim()) {
      setErr('Interner Name und Ziel-URL sind Pflicht.')
      return
    }
    if (!form.startsAtLocal || !form.endsAtLocal) {
      setErr('Start- und Endzeit setzen.')
      return
    }
    const startsAt = datetimeLocalToIso(form.startsAtLocal)
    const endsAt = datetimeLocalToIso(form.endsAtLocal)
    if (new Date(endsAt) <= new Date(startsAt)) {
      setErr('Ende muss nach Start liegen.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const payload = {
        internalName: form.internalName.trim(),
        headlineDe: form.headlineDe.trim(),
        headlineTr: form.headlineTr.trim(),
        headlineEn: form.headlineEn.trim(),
        bodyDe: form.bodyDe.trim(),
        bodyTr: form.bodyTr.trim(),
        bodyEn: form.bodyEn.trim(),
        imageUrl: form.imageUrl.trim(),
        ctaLabelDe: form.ctaLabelDe.trim(),
        ctaLabelTr: form.ctaLabelTr.trim(),
        ctaLabelEn: form.ctaLabelEn.trim(),
        ctaUrl: form.ctaUrl.trim(),
        startsAt,
        endsAt,
        isActive: form.isActive,
        priority: pr,
      }
      if (modal === 'create') {
        await createAdminPromotion(token, payload)
      } else if (modal === 'edit' && editing) {
        await patchAdminPromotion(token, editing.id, payload)
      }
      closeModal()
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Speichern fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  async function onDelete(id: string) {
    if (!token) return
    if (!window.confirm('Kampagne wirklich löschen?')) return
    setErr(null)
    try {
      await deleteAdminPromotion(token, id)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Löschen fehlgeschlagen')
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-8">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-black text-on-surface">Werbung & Hinweise</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-on-surface-variant">
            Vollbild-Karten im App-Shell: Zeitfenster, mehrsprachige Texte, klickbarer CTA. Impressionen und Klicks
            werden serverseitig gezählt (ein Impression beim Anzeigen, Klick über den Button).
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-black text-on-primary"
        >
          Neue Kampagne
        </button>
      </header>

      {err ? <p className="rounded-xl bg-error-container px-3 py-2 text-sm text-on-error-container">{err}</p> : null}

      <div className="overflow-x-auto rounded-2xl border border-outline-variant/40">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-surface-container-high/80 text-xs font-black uppercase tracking-wide text-on-surface-variant">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Zeitfenster</th>
              <th className="px-3 py-2">Aktiv</th>
              <th className="px-3 py-2">Prio</th>
              <th className="px-3 py-2">Impr.</th>
              <th className="px-3 py-2">Klicks</th>
              <th className="px-3 py-2">CTR</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const ctr =
                r.impressionCount > 0 ? ((100 * r.clickCount) / r.impressionCount).toFixed(1) : '–'
              return (
                <tr key={r.id} className="border-t border-outline-variant/30">
                  <td className="px-3 py-2 font-semibold">{r.internalName}</td>
                  <td className="px-3 py-2 text-xs text-on-surface-variant">
                    {new Date(r.startsAt).toLocaleString('de-DE')} – {new Date(r.endsAt).toLocaleString('de-DE')}
                  </td>
                  <td className="px-3 py-2">{r.isActive ? 'ja' : 'nein'}</td>
                  <td className="px-3 py-2">{r.priority}</td>
                  <td className="px-3 py-2 tabular-nums">{r.impressionCount}</td>
                  <td className="px-3 py-2 tabular-nums">{r.clickCount}</td>
                  <td className="px-3 py-2 tabular-nums">{ctr}{ctr !== '–' ? '%' : ''}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => openEdit(r)}
                      className="mr-2 rounded-lg border border-outline-variant px-2 py-1 text-xs font-bold"
                    >
                      Bearbeiten
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDelete(r.id)}
                      className="rounded-lg bg-error-container px-2 py-1 text-xs font-bold text-on-error-container"
                    >
                      Löschen
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-on-surface-variant">Noch keine Kampagnen.</p>
        ) : null}
      </div>

      {modal ? (
        <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/50 p-3 sm:items-center">
          <div className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-outline-variant/50 bg-surface p-4 shadow-2xl">
            <h2 className="text-lg font-black">{modal === 'create' ? 'Kampagne anlegen' : 'Kampagne bearbeiten'}</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="text-xs font-bold uppercase text-on-surface-variant">Interner Name</span>
                <input
                  value={form.internalName}
                  onChange={(e) => setForm((f) => ({ ...f, internalName: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs font-bold uppercase text-on-surface-variant">Start (lokal)</span>
                <input
                  type="datetime-local"
                  value={form.startsAtLocal}
                  onChange={(e) => setForm((f) => ({ ...f, startsAtLocal: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs font-bold uppercase text-on-surface-variant">Ende (lokal)</span>
                <input
                  type="datetime-local"
                  value={form.endsAtLocal}
                  onChange={(e) => setForm((f) => ({ ...f, endsAtLocal: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm"
                />
              </label>
              <label className="flex items-center gap-2 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                />
                <span className="text-sm font-semibold">Aktiv</span>
              </label>
              <label className="block">
                <span className="text-xs font-bold uppercase text-on-surface-variant">Priorität (höher = zuerst)</span>
                <input
                  value={form.priority}
                  onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs font-bold uppercase text-on-surface-variant">Bild-URL (optional)</span>
                <input
                  value={form.imageUrl}
                  onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
                  placeholder="https://…"
                  className="mt-1 w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs font-bold uppercase text-on-surface-variant">Ziel-URL (CTA)</span>
                <input
                  value={form.ctaUrl}
                  onChange={(e) => setForm((f) => ({ ...f, ctaUrl: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2 text-sm"
                />
              </label>
            </div>
            <p className="mt-4 text-xs font-bold uppercase text-on-surface-variant">Überschriften &amp; Texte</p>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              {(['Deutsch', 'Türkçe', 'English'] as const).map((label, i) => {
                const hk = ['headlineDe', 'headlineTr', 'headlineEn'][i] as keyof FormState
                const bk = ['bodyDe', 'bodyTr', 'bodyEn'][i] as keyof FormState
                const ck = ['ctaLabelDe', 'ctaLabelTr', 'ctaLabelEn'][i] as keyof FormState
                return (
                  <div key={label} className="space-y-2 rounded-xl border border-outline-variant/40 p-3">
                    <p className="text-xs font-black text-primary">{label}</p>
                    <input
                      value={String(form[hk])}
                      onChange={(e) => setForm((f) => ({ ...f, [hk]: e.target.value }))}
                      placeholder="Überschrift"
                      className="w-full rounded-lg border border-outline-variant bg-surface px-2 py-1.5 text-sm"
                    />
                    <textarea
                      value={String(form[bk])}
                      onChange={(e) => setForm((f) => ({ ...f, [bk]: e.target.value }))}
                      placeholder="Fließtext (optional)"
                      rows={3}
                      className="w-full rounded-lg border border-outline-variant bg-surface px-2 py-1.5 text-sm"
                    />
                    <input
                      value={String(form[ck])}
                      onChange={(e) => setForm((f) => ({ ...f, [ck]: e.target.value }))}
                      placeholder="Button-Label"
                      className="w-full rounded-lg border border-outline-variant bg-surface px-2 py-1.5 text-sm"
                    />
                  </div>
                )
              })}
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={closeModal} className="rounded-xl border border-outline-variant px-4 py-2 text-sm font-bold">
                Abbrechen
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void submitForm()}
                className="rounded-xl bg-primary px-4 py-2 text-sm font-black text-on-primary disabled:opacity-50"
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
