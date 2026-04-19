import { useCallback, useEffect, useState } from 'react'
import {
  createAdminRadioChannel,
  deleteAdminRadioChannel,
  fetchAdminRadioChannels,
  patchAdminRadioChannel,
  type RadioChannelDto,
} from '../lib/api'
import { useAuth } from '../context/AuthContext'

const emptyForm = {
  name: '',
  streamUrl: 'https://',
  sortOrder: '0',
  enabled: true,
}

export function AdminRadioChannelsPage() {
  const { token } = useAuth()
  const [rows, setRows] = useState<RadioChannelDto[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [modal, setModal] = useState<'create' | 'edit' | null>(null)
  const [editing, setEditing] = useState<RadioChannelDto | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    setErr(null)
    try {
      const { channels } = await fetchAdminRadioChannels(token)
      setRows(channels)
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

  function openEdit(p: RadioChannelDto) {
    setEditing(p)
    setForm({
      name: p.name,
      streamUrl: p.streamUrl,
      sortOrder: String(p.sortOrder),
      enabled: p.enabled,
    })
    setModal('edit')
  }

  function closeModal() {
    setModal(null)
    setEditing(null)
  }

  async function submitForm() {
    if (!token) return
    const sortOrder = parseInt(form.sortOrder, 10)
    if (!Number.isFinite(sortOrder)) {
      setErr('Sortierung als Zahl.')
      return
    }
    if (!form.name.trim() || !form.streamUrl.trim()) {
      setErr('Name und Stream-URL ausfüllen.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      if (modal === 'create') {
        await createAdminRadioChannel(token, {
          name: form.name.trim(),
          streamUrl: form.streamUrl.trim(),
          sortOrder,
          enabled: form.enabled,
        })
      } else if (modal === 'edit' && editing) {
        await patchAdminRadioChannel(token, editing.id, {
          name: form.name.trim(),
          streamUrl: form.streamUrl.trim(),
          sortOrder,
          enabled: form.enabled,
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

  async function onDelete(id: string) {
    if (!token) return
    if (!window.confirm('Kanal wirklich löschen?')) return
    setErr(null)
    try {
      await deleteAdminRadioChannel(token, id)
      await load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Löschen fehlgeschlagen')
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-black text-on-surface">Online-Radio</h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            Stream-URLs (Icecast, Shoutcast, direkte MP3/AAC-Streams). Nur https empfohlen.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-on-primary"
        >
          Neuer Kanal
        </button>
      </header>

      {err ? <p className="rounded-xl bg-error-container px-3 py-2 text-sm text-on-error-container">{err}</p> : null}

      <div className="overflow-x-auto rounded-2xl border border-outline-variant/40">
        <table className="w-full min-w-[28rem] text-left text-sm">
          <thead className="bg-surface-container-low text-on-surface-variant">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">URL</th>
              <th className="px-3 py-2">Sort</th>
              <th className="px-3 py-2">Aktiv</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-outline-variant/30">
                <td className="px-3 py-2 font-semibold">{r.name}</td>
                <td className="max-w-[14rem] truncate px-3 py-2 font-mono text-xs" title={r.streamUrl}>
                  {r.streamUrl}
                </td>
                <td className="px-3 py-2">{r.sortOrder}</td>
                <td className="px-3 py-2">{r.enabled ? 'ja' : 'nein'}</td>
                <td className="px-3 py-2 text-right">
                  <button type="button" className="font-bold text-primary" onClick={() => openEdit(r)}>
                    Bearbeiten
                  </button>
                  <button type="button" className="ml-2 font-bold text-error" onClick={() => void onDelete(r.id)}>
                    Löschen
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 p-3 sm:items-center">
          <div
            role="dialog"
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-surface p-4 shadow-xl"
          >
            <h2 className="text-lg font-black">{modal === 'create' ? 'Kanal anlegen' : 'Kanal bearbeiten'}</h2>
            <div className="mt-4 space-y-3">
              <label className="block text-sm font-semibold">
                Name
                <input
                  className="mt-1 w-full rounded-lg border border-outline-variant px-3 py-2"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </label>
              <label className="block text-sm font-semibold">
                Stream-URL (http/https)
                <input
                  className="mt-1 w-full rounded-lg border border-outline-variant px-3 py-2 font-mono text-sm"
                  value={form.streamUrl}
                  onChange={(e) => setForm((f) => ({ ...f, streamUrl: e.target.value }))}
                />
              </label>
              <label className="block text-sm font-semibold">
                Sortierung (höher zuerst)
                <input
                  className="mt-1 w-full rounded-lg border border-outline-variant px-3 py-2"
                  value={form.sortOrder}
                  onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
                />
              </label>
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
                />
                In der App sichtbar
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" className="rounded-lg px-4 py-2 font-bold text-on-surface-variant" onClick={closeModal}>
                Abbrechen
              </button>
              <button
                type="button"
                disabled={busy}
                className="rounded-lg bg-primary px-4 py-2 font-bold text-on-primary disabled:opacity-50"
                onClick={() => void submitForm()}
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
