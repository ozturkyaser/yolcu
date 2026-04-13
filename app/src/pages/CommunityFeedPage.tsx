import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CreatePostModal } from '../components/CreatePostModal'
import { PostCommentsSection } from '../components/PostCommentsSection'
import { apiFetch, reportPost, type PostDto } from '../lib/api'
import { useAuth } from '../context/AuthContext'

type FilterKey = 'all' | 'traffic' | 'border' | 'help'

const filters: { key: FilterKey; label: string; api?: string }[] = [
  { key: 'all', label: 'Hepsi' },
  { key: 'traffic', label: 'Trafik', api: 'traffic' },
  { key: 'border', label: 'Sınır Durumu', api: 'border' },
  { key: 'help', label: 'Yardım Talepleri', api: 'help' },
]

function formatTime(iso: string) {
  const d = new Date(iso)
  const diff = (Date.now() - d.getTime()) / 60000
  if (diff < 1) return 'gerade eben'
  if (diff < 60) return `vor ${Math.floor(diff)} Min.`
  if (diff < 1440) return `vor ${Math.floor(diff / 60)} Std.`
  return d.toLocaleDateString('de-DE')
}

function badgeForCategory(c: string) {
  switch (c) {
    case 'traffic':
      return { text: 'TRAFİK', className: 'bg-secondary-container text-on-secondary-container' }
    case 'border':
      return { text: 'SINIR', className: 'bg-primary/15 text-primary' }
    case 'help':
      return { text: 'YARDIM', className: 'bg-error/15 text-error' }
    default:
      return { text: 'GENEL', className: 'bg-surface-container-high text-on-surface-variant' }
  }
}

export function CommunityFeedPage() {
  const { token, user } = useAuth()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<FilterKey>('all')
  const [posts, setPosts] = useState<PostDto[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [modal, setModal] = useState(false)
  const [commentsOpenFor, setCommentsOpenFor] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const api = filters.find((f) => f.key === filter)?.api
      const q = api ? `?category=${encodeURIComponent(api)}` : ''
      const data = await apiFetch<{ posts: PostDto[] }>(`/posts${q}`)
      setPosts(data.posts)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Laden fehlgeschlagen')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    void load()
  }, [load])

  async function sharePost(p: PostDto) {
    const text = `${p.body}\n— ${p.author.displayName} · Yol Arkadaşım`
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Yol Arkadaşım', text })
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      }
    } catch {
      /* Abbruch oder nicht unterstützt */
    }
  }

  async function onReportPost(postId: string) {
    if (!token) {
      navigate('/login')
      return
    }
    const reason = window.prompt('Grund der Meldung (min. 3 Zeichen):')
    if (!reason || reason.trim().length < 3) return
    try {
      await reportPost(token, postId, reason.trim())
      window.alert('Danke – die Meldung wurde gespeichert.')
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Meldung fehlgeschlagen')
    }
  }

  async function onHelpful(postId: string) {
    if (!token) {
      navigate('/login')
      return
    }
    try {
      const data = await apiFetch<{ helpfulCount: number }>(`/posts/${postId}/helpful`, {
        method: 'POST',
        token,
      })
      setPosts((prev) =>
        prev.map((p) => (p.id === postId ? { ...p, helpfulCount: data.helpfulCount } : p)),
      )
    } catch {
      /* ignore */
    }
  }

  return (
    <>
      <div className="fixed top-[72px] left-0 z-40 h-1 w-full bg-gradient-to-r from-primary via-secondary to-primary opacity-80" />
      <main className="mx-auto max-w-2xl px-4 pt-6 pb-28">
        <div className="mb-8 -mx-4 overflow-x-auto px-4 hide-scrollbar">
          <div className="flex items-center space-x-3">
            {filters.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={
                  filter === f.key
                    ? 'rounded-full bg-primary px-6 py-2.5 text-sm font-bold tracking-wide text-on-primary shadow-lg'
                    : 'whitespace-nowrap rounded-full bg-surface-container-low px-6 py-2.5 text-sm font-semibold text-on-surface-variant hover:bg-surface-container-high'
                }
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {err ? (
          <div className="mb-4 rounded-2xl bg-error-container p-4 text-sm text-on-error-container">{err}</div>
        ) : null}
        {loading ? <p className="text-center text-on-surface-variant">Laden…</p> : null}

        <div className="space-y-6">
          {!loading && posts.length === 0 ? (
            <p className="text-center text-on-surface-variant">Noch keine Meldungen. Sei der Erste!</p>
          ) : null}
          {posts.map((p) => {
            const b = badgeForCategory(p.category)
            return (
              <article
                key={p.id}
                className="relative overflow-hidden rounded-[2rem] bg-surface-container-lowest p-6 shadow-[0_8px_32px_rgba(26,28,28,0.04)]"
              >
                <div className="mb-4 flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-container-low font-bold text-primary">
                      {p.author.displayName.slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="font-bold leading-tight text-on-surface">{p.author.displayName}</h3>
                      <p className="text-xs font-medium uppercase tracking-wider text-on-surface-variant">
                        {formatTime(p.createdAt)}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-[10px] font-black tracking-tighter uppercase ${b.className}`}
                  >
                    {b.text}
                  </span>
                </div>
                <p className="mb-4 text-lg font-medium leading-relaxed text-on-surface-variant">{p.body}</p>
                {p.category === 'border' && (p.borderWaitMinutes != null || p.borderSlug) ? (
                  <div className="mb-4 flex flex-wrap gap-2 text-xs">
                    {p.borderWaitMinutes != null ? (
                      <span className="rounded-lg bg-primary/10 px-2 py-1 font-bold text-primary">
                        ~{p.borderWaitMinutes} Min. Wartezeit
                      </span>
                    ) : null}
                    {p.borderSlug ? (
                      <Link
                        to={`/border/${encodeURIComponent(p.borderSlug)}`}
                        className="rounded-lg border border-outline-variant px-2 py-1 font-bold text-primary underline"
                      >
                        Grenze: {p.borderSlug}
                      </Link>
                    ) : null}
                  </div>
                ) : null}
                {p.locationLabel ? (
                  <div className="mb-4 flex w-fit items-center gap-2 rounded-xl bg-surface-container-low px-3 py-1.5">
                    <span className="material-symbols-outlined text-sm text-primary">location_on</span>
                    <span className="text-xs font-bold text-primary">{p.locationLabel}</span>
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-2 border-t border-surface-container pt-4">
                  <button
                    type="button"
                    onClick={() => void onHelpful(p.id)}
                    className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-primary hover:bg-primary-fixed"
                  >
                    <span className="material-symbols-outlined text-lg">thumb_up</span>
                    Faydalı ({p.helpfulCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => void sharePost(p)}
                    className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-on-surface-variant hover:bg-surface-container-high"
                  >
                    <span className="material-symbols-outlined text-lg">share</span>
                    Teilen
                  </button>
                  <button
                    type="button"
                    onClick={() => void onReportPost(p.id)}
                    className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-on-surface-variant hover:bg-surface-container-high"
                  >
                    <span className="material-symbols-outlined text-lg">flag</span>
                    Melden
                  </button>
                </div>
                <PostCommentsSection
                  postId={p.id}
                  expanded={commentsOpenFor === p.id}
                  onToggle={() =>
                    setCommentsOpenFor((cur) => (cur === p.id ? null : p.id))
                  }
                />
              </article>
            )
          })}
        </div>
      </main>

      <button
        type="button"
        onClick={() => {
          if (!user) navigate('/login')
          else setModal(true)
        }}
        className="fixed bottom-28 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full bg-gradient-to-br from-primary to-primary-container px-8 py-4 font-black text-on-primary shadow-xl"
      >
        <span className="material-symbols-outlined">add</span>
        Meldung
      </button>

      <CreatePostModal
        open={modal}
        onClose={() => setModal(false)}
        onCreated={(post) => setPosts((prev) => [post, ...prev])}
        defaultCategory={
          filter === 'traffic'
            ? 'traffic'
            : filter === 'border'
              ? 'border'
              : filter === 'help'
                ? 'help'
                : 'general'
        }
      />
    </>
  )
}
