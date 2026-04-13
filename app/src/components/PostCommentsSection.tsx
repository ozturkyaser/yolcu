import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWebmVoiceRecord } from '../hooks/useWebmVoiceRecord'
import { fetchPostComments, postComment, postCommentVoice, type PostCommentDto } from '../lib/api'
import { VoiceAuthAudio } from './VoiceAuthAudio'
import { useAuth } from '../context/AuthContext'

type Props = {
  postId: string
  expanded: boolean
  onToggle: () => void
}

function formatCommentTime(iso: string) {
  const d = new Date(iso)
  const diff = (Date.now() - d.getTime()) / 60000
  if (diff < 1) return 'gerade'
  if (diff < 60) return `vor ${Math.floor(diff)} Min.`
  if (diff < 1440) return `vor ${Math.floor(diff / 60)} Std.`
  return d.toLocaleDateString('de-DE')
}

export function PostCommentsSection({ postId, expanded, onToggle }: Props) {
  const { token, user } = useAuth()
  const navigate = useNavigate()
  const [comments, setComments] = useState<PostCommentDto[]>([])
  const [loading, setLoading] = useState(false)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [voiceBusy, setVoiceBusy] = useState(false)
  const { isRecording, start: startVoiceRec, stop: stopVoiceRec } = useWebmVoiceRecord()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchPostComments(postId)
      setComments(data.comments)
    } catch {
      setComments([])
    } finally {
      setLoading(false)
    }
  }, [postId])

  useEffect(() => {
    if (expanded) void load()
  }, [expanded, load])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!token) {
      navigate('/login')
      return
    }
    const text = body.trim()
    if (!text) return
    setSending(true)
    try {
      const { comment } = await postComment(token, postId, text)
      setBody('')
      setComments((prev) => [...prev, comment])
    } catch {
      /* ignore */
    } finally {
      setSending(false)
    }
  }

  async function toggleVoiceComment() {
    if (!token) {
      navigate('/login')
      return
    }
    if (!isRecording) {
      try {
        await startVoiceRec()
      } catch {
        /* ignore */
      }
      return
    }
    setVoiceBusy(true)
    try {
      const pack = await stopVoiceRec()
      if (!pack) return
      const { comment } = await postCommentVoice(token, postId, pack.blob, pack.durationMs, body.trim() || undefined)
      setBody('')
      setComments((prev) => [...prev, comment])
    } catch {
      /* ignore */
    } finally {
      setVoiceBusy(false)
    }
  }

  return (
    <div className="border-t border-surface-container pt-4">
      <button
        type="button"
        onClick={onToggle}
        className="mb-3 flex w-full items-center justify-between text-left text-sm font-bold text-primary"
      >
        <span>Kommentare {comments.length > 0 ? `(${comments.length})` : ''}</span>
        <span className="material-symbols-outlined text-lg">{expanded ? 'expand_less' : 'expand_more'}</span>
      </button>
      {expanded ? (
        <div className="space-y-3">
          {loading ? <p className="text-xs text-on-surface-variant">Laden…</p> : null}
          {comments.map((c) => (
            <div key={c.id} className="rounded-xl bg-surface-container-low px-3 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-bold text-on-surface">{c.author.displayName}</span>
                <span className="text-xs text-on-surface-variant">{formatCommentTime(c.createdAt)}</span>
              </div>
              {c.messageType === 'voice' && c.voiceUrl ? (
                <div className="mt-1 space-y-1">
                  {c.body?.trim() ? <p className="text-sm text-on-surface-variant">{c.body}</p> : null}
                  <VoiceAuthAudio voicePath={c.voiceUrl} token={token} className="h-8 w-full max-w-xs" />
                </div>
              ) : (
                <p className="mt-1 text-sm text-on-surface-variant">{c.body}</p>
              )}
            </div>
          ))}
          <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <input
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={user ? 'Kommentar oder Bildunterschrift zur Sprache…' : 'Zum Kommentieren anmelden'}
              disabled={!user}
              maxLength={2000}
              className="min-w-0 flex-[1_1_12rem] rounded-xl border border-outline-variant bg-surface px-3 py-2 text-sm text-on-surface disabled:opacity-50"
            />
            <button
              type="button"
              disabled={!user || voiceBusy}
              onClick={() => void toggleVoiceComment()}
              className={
                isRecording
                  ? 'rounded-xl bg-error px-4 py-2 text-sm font-bold text-on-error'
                  : 'rounded-xl border border-outline-variant bg-surface-container-high px-4 py-2 text-sm font-bold text-on-surface'
              }
            >
              {isRecording ? 'Sprache senden' : 'Sprache'}
            </button>
            <button
              type="submit"
              disabled={!user || sending || !body.trim()}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-bold text-on-primary disabled:opacity-50"
            >
              Text senden
            </button>
          </form>
        </div>
      ) : null}
    </div>
  )
}
