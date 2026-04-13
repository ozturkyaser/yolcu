import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { readStoredLang, STRINGS, writeStoredLang, type Lang } from './strings'

type Ctx = {
  lang: Lang
  setLang: (l: Lang) => void
  t: (key: string) => string
}

const I18nContext = createContext<Ctx | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => readStoredLang())

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    writeStoredLang(l)
  }, [])

  const t = useCallback(
    (key: string) => {
      const pack = STRINGS[lang] ?? STRINGS.de
      return pack[key] ?? STRINGS.de[key] ?? key
    },
    [lang],
  )

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): Ctx {
  const c = useContext(I18nContext)
  if (!c) throw new Error('useI18n outside I18nProvider')
  return c
}
