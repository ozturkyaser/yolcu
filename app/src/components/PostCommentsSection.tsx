import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWebmVoiceRecord } from '../hooks/useWebmVoiceRecord'
import { fetchPostComments, postComment, postCommentVoice, type PostCommentDto } from '../lib/api'
import { VoiceAuthAudio } from './VoiceAuthAudio'
import { useAuth } from '../context/AuthContext'
import { useRadioPlayer } from '../context/RadioPlayerContext'
import { useI18n } from '../i18n/I18nContext'
import type { Lang } from '../i18n/strings'

type Props = {
  postId: string
  expanded: boolean
  onToggle: () => void
}

function formatCommentTime(iso: string, lang: Lang) {
  const d = new Date(iso)
  const diff = (Date.now() - d.getTime()) / 60000
  if (diff < 1) {
    if (lang === 'tr') return 'şimdi'
    if (lang === 'en') return 'now'
    return 'gerade'
  }
  if (diff < 60) {
    const n = Math.floor(diff)
    if (lang === 'tr') return `${n} dk`
    if (lang === 'en') return `${n}m`
    return `${n} Min.`
  }
  if (diff < 1440) {
    const h = Math.floor(diff / 60)
    if (lang === 'tr') return `${h} sa`
    if (lang === 'en') return `${h}h`
    return `${h} Std.`
  }
  const loc = lang === 'tr' ? 'tr-TR' : lang === 'en' ? 'en-GB' : 'de-DE'
  return d.toLocaleDateString(loc, { day: 'numeric', month: 'short' })
}

export function PostCommentsSection({ postId, expanded, onToggle }: Props) {
  const { token, user } = useAuth()
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const [comments, setComments] = useState<PostCommentDto[]>([])
  const [loading, setLoading] = useState(false)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [voiceBusy, setVoiceBusy] = useState(false)
  const { isRecording, start: startVoiceRec, stop: stopVoiceRec } = useWebmVoiceRecord()
  const radio = useRadioPlayer()

  useEffect(() => {
    if (isRecording) {
      radio.beginUserCapture()
      return () => radio.endUserCapture()
    }
  }, [isRecording, radio])

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

  const countLabel =
    comments.length > 0 ? `${t('community_comments_title')} (${comments.length})` : t('community_comments_title')

  return (
    <div className="pt-1">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-2 rounded-xl px-1 py-2 text-left text-[13px] font-semibold text-on-surface transition hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
      >
        <span className="truncate">{countLabel}</span>
        <span className="material-symbols-outlined shrink-0 text-xl text-on-surface-variant">
          {expanded ? 'expand_less' : 'expand_more'}
        </span>
      </button>
      {expanded ? (
        <div className="space-y-3 pb-1">
          {loading ? (
            <p className="px-0.5 text-xs text-on-surface-variant">{t('community_comments_loading')}</p>
          ) : null}
          {comments.map((c) => (
            <div
              key={c.id}
              className="rounded-2xl border border-outline-variant/25 bg-surface-container-low/80 px-3.5 py-2.5 backdrop-blur-sm"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-on-surface">{c.author.displayName}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-on-surface-variant">
                  {formatCommentTime(c.createdAt, lang)}
                </span>
              </div>
              {c.messageType === 'voice' && c.voiceUrl ? (
                <div className="mt-1.5 space-y-1.5">
                  {c.body?.trim() ? <p className="text-sm text-on-surface">{c.body}</p> : null}
                  <VoiceAuthAudio voicePath={c.voiceUrl} token={token} className="h-8 w-full max-w-xs" />
                </div>
              ) : (
                <p className="mt-1.5 text-sm leading-snug text-on-surface">{c.body}</p>
              )}
            </div>
          ))}
          <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <input
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={
                user
                  ? isRecording
                    ? t('community_comment_field_ph_voice')
                    : t('community_comment_field_ph')
                  : t('community_comment_guest')
              }
              disabled={!user}
              maxLength={2000}
              className="min-w-0 flex-[1_1_12rem] rounded-2xl border border-outline-variant/50 bg-surface px-3.5 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/70 disabled:opacity-50"
            />
            <button
              type="button"
              disabled={!user || voiceBusy}
              onClick={() => void toggleVoiceComment()}
              className={
                isRecording
                  ? 'rounded-2xl bg-error px-4 py-2.5 text-sm font-semibold text-on-error'
                  : 'rounded-2xl border border-outline-variant/50 bg-surface-container-high px-4 py-2.5 text-sm font-semibold text-on-surface'
              }
            >
              {isRecording ? t('community_voice_sending') : t('community_voice_btn')}
            </button>
            <button
              type="submit"
              disabled={!user || sending || !body.trim()}
              className="rounded-2xl bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary disabled:opacity-50"
            >
              {t('community_text_send')}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  )
}
