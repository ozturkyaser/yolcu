import { useEffect, useMemo, useState } from 'react'
import { fetchAdminAiSettings, saveAdminAiSettings } from '../lib/api'
import { DEFAULT_OPENROUTER_MODEL_ID, OPENROUTER_MODEL_OPTIONS_FALLBACK } from '../lib/openRouterModels'
import { useAuth } from '../context/AuthContext'

export function AdminAiSettingsPage() {
  const { token } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [aiModel, setAiModel] = useState(DEFAULT_OPENROUTER_MODEL_ID)
  const [openRouterBase, setOpenRouterBase] = useState('https://openrouter.ai/api/v1')
  const [modelOptions, setModelOptions] = useState<{ id: string; label: string }[]>([])
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [hasStoredKey, setHasStoredKey] = useState(false)
  const [keyLast4, setKeyLast4] = useState<string | null>(null)
  const [defaultExtra, setDefaultExtra] = useState('')

  useEffect(() => {
    if (!token) {
      setLoading(false)
      return
    }
    let cancelled = false
    void (async () => {
      setErr(null)
      setLoading(true)
      try {
        const d = await fetchAdminAiSettings(token)
        if (cancelled) return
        const raw = (d as { availableModels?: { id: string; label: string }[] }).availableModels
        const opts = Array.isArray(raw) && raw.length > 0 ? raw : OPENROUTER_MODEL_OPTIONS_FALLBACK
        setModelOptions(opts)
        const m = typeof d.aiModel === 'string' && d.aiModel.trim() ? d.aiModel.trim() : DEFAULT_OPENROUTER_MODEL_ID
        setAiModel(opts.some((x) => x.id === m) ? m : opts[0]?.id ?? DEFAULT_OPENROUTER_MODEL_ID)
        setOpenRouterBase(d.openRouterApiBase ?? 'https://openrouter.ai/api/v1')
        setDefaultExtra(d.defaultExtraSystemPrompt ?? '')
        setHasStoredKey(d.hasApiKey)
        setKeyLast4(d.apiKeyLast4)
        setApiKeyInput('')
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Laden fehlgeschlagen')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  const options = useMemo(
    () => (modelOptions.length > 0 ? modelOptions : OPENROUTER_MODEL_OPTIONS_FALLBACK),
    [modelOptions],
  )

  const selectValue = useMemo(() => {
    if (options.some((o) => o.id === aiModel)) return aiModel
    return options[0]?.id ?? DEFAULT_OPENROUTER_MODEL_ID
  }, [options, aiModel])

  useEffect(() => {
    if (loading || options.length === 0) return
    if (!options.some((o) => o.id === aiModel)) {
      setAiModel(options[0]!.id)
    }
  }, [loading, options, aiModel])

  async function save() {
    if (!token) return
    setSaving(true)
    setErr(null)
    setMsg(null)
    try {
      const modelToSave = options.some((o) => o.id === aiModel) ? aiModel : options[0]?.id ?? DEFAULT_OPENROUTER_MODEL_ID
      const r = await saveAdminAiSettings(token, {
        aiModel: modelToSave,
        defaultExtraSystemPrompt: defaultExtra.trim() || null,
        ...(apiKeyInput.trim() ? { openaiApiKey: apiKeyInput.trim() } : {}),
      })
      setHasStoredKey(r.hasApiKey)
      setKeyLast4(r.apiKeyLast4)
      const nextOpts =
        Array.isArray(r.availableModels) && r.availableModels.length > 0 ? r.availableModels : OPENROUTER_MODEL_OPTIONS_FALLBACK
      setModelOptions(nextOpts)
      const rm = typeof r.aiModel === 'string' && r.aiModel.trim() ? r.aiModel.trim() : modelToSave
      setAiModel(nextOpts.some((x) => x.id === rm) ? rm : nextOpts[0]?.id ?? modelToSave)
      setOpenRouterBase(r.openRouterApiBase ?? 'https://openrouter.ai/api/v1')
      setApiKeyInput('')
      setMsg('KI-Einstellungen gespeichert.')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Speichern fehlgeschlagen')
    } finally {
      setSaving(false)
    }
  }

  async function clearKey() {
    if (!token) return
    setSaving(true)
    setErr(null)
    setMsg(null)
    try {
      const r = await saveAdminAiSettings(token, { clearApiKey: true })
      setHasStoredKey(r.hasApiKey)
      setKeyLast4(r.apiKeyLast4)
      setApiKeyInput('')
      setMsg('API-Schlüssel entfernt.')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Speichern fehlgeschlagen')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-black text-on-surface">KI / OpenRouter</h1>
        <p className="mt-1 text-sm text-on-surface-variant">
          Es wird die{' '}
          <a
            href="https://openrouter.ai/"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-primary underline"
          >
            OpenRouter
          </a>
          -API genutzt (ein Schlüssel, viele Modelle). Der API-Key wird verschlüsselt gespeichert. Alternativ kann{' '}
          <code className="rounded bg-surface-container-high px-1">OPENAI_API_KEY</code> bzw.{' '}
          <code className="rounded bg-surface-container-high px-1">AI_API_KEY</code> in der Server-Umgebung gesetzt
          sein (OpenRouter-Schlüssel) – dann hat die Umgebung Vorrang vor dem hier hinterlegten Schlüssel.
        </p>
      </header>

      {err ? <p className="rounded-xl bg-error-container px-3 py-2 text-sm text-on-error-container">{err}</p> : null}
      {msg ? (
        <p className="rounded-xl border border-outline-variant/40 bg-primary-container/25 px-3 py-2 text-sm text-on-surface">
          {msg}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-on-surface-variant">Laden…</p>
      ) : (
        <section className="rounded-2xl border border-outline-variant/50 bg-surface-container-low p-4 space-y-4">
          <div className="rounded-xl border border-outline-variant/30 bg-surface-container-high/40 px-3 py-2">
            <p className="text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">API-Endpunkt</p>
            <p className="mt-1 break-all font-mono text-xs text-on-surface">{openRouterBase}</p>
            <p className="mt-1 text-xs text-on-surface-variant">Fest vorgegeben, keine manuelle Basis-URL nötig.</p>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">
              OpenRouter API-Schlüssel
            </label>
            <p className="mt-1 text-xs text-on-surface-variant">
              Unter openrouter.ai erstellen. Wird nicht im Klartext angezeigt; nur die letzten vier Zeichen zur
              Orientierung.
            </p>
            {hasStoredKey ? (
              <p className="mt-2 text-xs font-medium text-primary">
                Ein Schlüssel ist gespeichert{keyLast4 ? ` · …${keyLast4}` : ''}
              </p>
            ) : null}
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder={hasStoredKey ? 'Neuen Schlüssel eintragen zum Ersetzen' : 'sk-or-v1-…'}
              className="mt-2 w-full rounded-2xl border border-outline-variant/40 bg-surface px-3 py-2.5 font-mono text-sm"
              autoComplete="new-password"
            />
            {hasStoredKey ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => void clearKey()}
                className="mt-2 text-xs font-bold text-error underline disabled:opacity-40"
              >
                Gespeicherten Schlüssel löschen
              </button>
            ) : null}
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">Modell</label>
            <p className="mt-1 text-xs text-on-surface-variant">Beliebte Modelle über OpenRouter (ID wie in der API).</p>
            <select
              value={selectValue}
              onChange={(e) => setAiModel(e.target.value)}
              className="mt-2 w-full min-h-11 cursor-pointer rounded-2xl border border-outline-variant/40 bg-surface px-3 py-2.5 text-sm font-medium text-on-surface"
              style={{ WebkitAppearance: 'menulist' }}
            >
              {options.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wide text-on-surface-variant">
              Standard-Zusatz zum System-Prompt
            </label>
            <p className="mt-1 text-xs text-on-surface-variant">
              Gilt für alle Anfragen; Nutzer können im Profil einen weiteren Zusatz-Prompt ergänzen.
            </p>
            <textarea
              value={defaultExtra}
              onChange={(e) => setDefaultExtra(e.target.value)}
              rows={5}
              placeholder="z. B. immer kurz antworten …"
              className="mt-2 w-full resize-y rounded-2xl border border-outline-variant/40 bg-surface px-3 py-2.5 text-sm"
            />
          </div>

          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-on-primary disabled:opacity-50"
          >
            {saving ? 'Speichern…' : 'Speichern'}
          </button>
        </section>
      )}
    </div>
  )
}
