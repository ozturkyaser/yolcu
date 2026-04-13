import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useWebmVoiceRecord } from '../hooks/useWebmVoiceRecord'
import { fetchSharedGroupsWithUser, postGroupMessage, postGroupVoiceMessage } from '../lib/api'

export type ParticipantSheetUser = {
  userId: string
  displayName: string
  lat: number
  lng: number
}

type Props = {
  open: boolean
  onClose: () => void
  participant: ParticipantSheetUser | null
  token: string | null
  onRouteToParticipant: (p: ParticipantSheetUser) => void
}

export function ParticipantActionModal({
  open,
  onClose,
  participant,
  token,
  onRouteToParticipant,
}: Props) {
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [groupId, setGroupId] = useState('')
  const [messageBody, setMessageBody] = useState('')
  const [sending, setSending] = useState(false)
  const [voiceBusy, setVoiceBusy] = useState(false)
  const [sentToGroupId, setSentToGroupId] = useState<string | null>(null)
  const { isRecording, start: startVoiceRec, stop: stopVoiceRec } = useWebmVoiceRecord()

  useEffect(() => {
    if (!open || !participant || !token) {
      setGroups([])
      setGroupId('')
      setMessageBody('')
      setErr(null)
      setSentToGroupId(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setErr(null)
    setSentToGroupId(null)
    void fetchSharedGroupsWithUser(token, participant.userId)
      .then((d) => {
        if (cancelled) return
        setGroups(d.groups)
        if (d.groups.length === 1) setGroupId(d.groups[0].id)
        else setGroupId('')
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Laden fehlgeschlagen')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, participant?.userId, token])

  async function send() {
    if (!token || !groupId || !messageBody.trim()) return
    setSending(true)
    setErr(null)
    try {
      await postGroupMessage(token, groupId, messageBody.trim())
      setSentToGroupId(groupId)
      setMessageBody('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Senden fehlgeschlagen')
    } finally {
      setSending(false)
    }
  }

  async function toggleVoiceToGroup() {
    if (!token || !groupId) return
    setErr(null)
    if (!isRecording) {
      try {
        await startVoiceRec()
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Mikrofon nicht verfügbar')
      }
      return
    }
    setVoiceBusy(true)
    try {
      const pack = await stopVoiceRec()
      if (!pack) return
      await postGroupVoiceMessage(token, groupId, pack.blob, pack.durationMs, messageBody.trim() || undefined)
      setSentToGroupId(groupId)
      setMessageBody('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Sprachnachricht fehlgeschlagen')
    } finally {
      setVoiceBusy(false)
    }
  }

  if (!open || !participant) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-4 sm:items-center"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="participant-sheet-title"
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-3xl bg-surface-container-lowest p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="participant-sheet-title" className="mb-1 text-xl font-black text-primary">
          {participant.displayName}
        </h2>
        <p className="mb-4 text-xs text-on-surface-variant">
          Teilnehmer mit freigegebener Position. Nachrichten gehen über eure gemeinsame Gruppe.
        </p>

        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              onRouteToParticipant(participant)
              onClose()
            }}
            className="rounded-xl bg-secondary-container px-4 py-2.5 text-sm font-bold text-on-secondary-container"
          >
            Route zum Standort
          </button>
        </div>

        {!token ? (
          <p className="rounded-xl bg-secondary-container/30 p-4 text-sm text-on-secondary-container">
            <Link to="/login" className="font-bold underline">
              Anmelden
            </Link>
            , um eine Nachricht zu senden.
          </p>
        ) : loading ? (
          <p className="text-sm text-on-surface-variant">Gemeinsame Gruppen werden geladen…</p>
        ) : (
          <>
            {err ? (
              <p className="mb-3 rounded-xl bg-error-container p-3 text-sm text-on-error-container">{err}</p>
            ) : null}
            {groups.length === 0 && !err ? (
              <p className="rounded-xl bg-surface-container-high p-4 text-sm text-on-surface-variant">
                Ihr seid in keiner gemeinsamen Gruppe. Erstellt eine Gruppe unter „Gruppen“ oder trettet mit
                Einladungscode bei – dann könnt ihr euch hier schreiben.
              </p>
            ) : null}
            {groups.length > 0 ? (
              <div className="space-y-3 border-t border-outline-variant/30 pt-4">
                <p className="text-xs font-bold uppercase tracking-wide text-on-surface-variant">
                  Nachricht (Gruppenchat)
                </p>
                {groups.length > 1 ? (
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-bold uppercase text-on-surface-variant">
                      Gruppe
                    </span>
                    <select
                      value={groupId}
                      onChange={(e) => setGroupId(e.target.value)}
                      className="w-full rounded-xl border border-outline-variant/50 bg-surface-container-low px-3 py-2 text-sm font-semibold text-on-surface"
                    >
                      <option value="">Gruppe wählen…</option>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <p className="text-sm font-semibold text-on-surface">
                    Gruppe: <span className="text-primary">{groups[0].name}</span>
                  </p>
                )}
                <textarea
                  value={messageBody}
                  onChange={(e) => setMessageBody(e.target.value)}
                  placeholder="Nachricht eingeben…"
                  maxLength={4000}
                  rows={3}
                  className="w-full resize-y rounded-xl border border-outline-variant/50 bg-surface-container-low px-3 py-2 text-sm text-on-surface"
                />
                <p className="text-[10px] text-on-surface-variant">
                  Optional: Text als Bildunterschrift zur Sprachnachricht nutzen.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!groupId || voiceBusy}
                    onClick={() => void toggleVoiceToGroup()}
                    className={
                      isRecording
                        ? 'rounded-xl bg-error px-4 py-2.5 text-sm font-bold text-on-error'
                        : 'rounded-xl border border-outline-variant px-4 py-2.5 text-sm font-bold text-on-surface'
                    }
                  >
                    {isRecording ? 'Stop & Sprache senden' : 'Sprachnachricht'}
                  </button>
                  <button
                    type="button"
                    disabled={!groupId || !messageBody.trim() || sending}
                    onClick={() => void send()}
                    className="rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-on-primary disabled:opacity-50"
                  >
                    {sending ? 'Senden…' : 'Text senden'}
                  </button>
                  {sentToGroupId ? (
                    <Link
                      to={`/groups/${sentToGroupId}`}
                      className="rounded-xl border border-outline-variant px-4 py-2.5 text-sm font-bold text-on-surface"
                      onClick={onClose}
                    >
                      Zum Gruppenchat
                    </Link>
                  ) : null}
                </div>
              </div>
            ) : null}
          </>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-6 w-full rounded-xl border border-outline-variant py-3 text-sm font-bold text-on-surface"
        >
          Schließen
        </button>
      </div>
    </div>
  )
}
