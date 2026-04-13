export type Lang = 'de' | 'tr' | 'en'

const LS = 'yol_ui_lang'

export function readStoredLang(): Lang {
  try {
    const v = localStorage.getItem(LS)
    if (v === 'tr' || v === 'en' || v === 'de') return v
  } catch {
    /* ignore */
  }
  return 'de'
}

export function writeStoredLang(lang: Lang) {
  try {
    localStorage.setItem(LS, lang)
  } catch {
    /* ignore */
  }
}

/** Minimale UI-Strings – erweiterbar. */
export const STRINGS: Record<Lang, Record<string, string>> = {
  de: {
    appTitle: 'Yol Arkadaşım',
    navMap: 'Karte',
    navCommunity: 'Community',
    navGroups: 'Gruppen',
    navProfile: 'Profil',
    login: 'Anmelden',
    privacyHint: 'i',
  },
  tr: {
    appTitle: 'Yol Arkadaşım',
    navMap: 'Harita',
    navCommunity: 'Topluluk',
    navGroups: 'Gruplar',
    navProfile: 'Profil',
    login: 'Giriş',
    privacyHint: 'i',
  },
  en: {
    appTitle: 'Yol Arkadaşım',
    navMap: 'Map',
    navCommunity: 'Community',
    navGroups: 'Groups',
    navProfile: 'Profile',
    login: 'Log in',
    privacyHint: 'i',
  },
}
