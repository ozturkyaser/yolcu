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
    onboarding_kicker: 'Kurzüberblick',
    onboarding_progress: 'Schritte',
    onboarding_skip: 'Überspringen',
    onboarding_back: 'Zurück',
    onboarding_next: 'Weiter',
    onboarding_done: 'Loslegen',
    onboarding_closeBackdrop: 'Einführung schließen',
    onboarding_s0_title: 'Willkommen bei Yol Arkadaşım',
    onboarding_s0_body:
      'Ihre Begleit-App für die Reise in die Heimat und zurück: Karte, Community, Gruppenchat und praktische Hinweise entlang der Route – durchdacht für Alltag und lange Fahrten.',
    onboarding_s1_title: 'Karte & Navigation',
    onboarding_s1_body:
      'Planen Sie Routen, sehen Sie sich und andere Mitreisende auf der Karte, und nutzen Sie bei Bedarf die Hilfe-Funktion. So behalten Sie Orientierung und bleiben mit Ihrer Gruppe verbunden.',
    onboarding_s1_b1: 'Route planen: Ziel wählen, Start anpassen, Linie folgen.',
    onboarding_s1_b2: 'Optional die eigene Position teilen – nur wenn Sie es möchten.',
    onboarding_s1_b3: 'SOS/Hilfe über die rote Schaltfläche – auch ohne Konto nutzbar.',
    onboarding_s2_title: 'Community',
    onboarding_s2_body:
      'Lesen und teilen Sie Erfahrungen von anderen Reisenden: Tipps, Meldungen und Austausch rund um Grenzen, Pausen und Unterwegs-Themen – immer mit respektvollem Umgang.',
    onboarding_s3_title: 'Gruppen & Konvoi',
    onboarding_s3_body:
      'Erstellen oder treten Sie Gruppen bei, chatten Sie unterwegs und koordinieren Sie Fahrten mit Ziel und Status. Ideal für Familie, Freunde oder Konvoi-Fahrten.',
    onboarding_s4_title: 'Profil & Konto',
    onboarding_s4_body:
      'Hier verwalten Sie Anzeigename, Sprache, Fahrzeugklasse für Maut-Hinweise und weitere Einstellungen. Melden Sie sich an, um alle Funktionen freizuschalten.',
    onboarding_s5_title: 'Bereit für die Fahrt',
    onboarding_s5_body:
      'Unten wechseln Sie jederzeit zwischen Karte, Community, Gruppen und Profil. Über „?“ oder Hilfe erreichen Sie Unterstützung. Wir wünschen eine gute und sichere Reise.',
  },
  tr: {
    appTitle: 'Yol Arkadaşım',
    navMap: 'Harita',
    navCommunity: 'Topluluk',
    navGroups: 'Gruplar',
    navProfile: 'Profil',
    login: 'Giriş',
    privacyHint: 'i',
    onboarding_kicker: 'Kısa tanıtım',
    onboarding_progress: 'Adımlar',
    onboarding_skip: 'Atla',
    onboarding_back: 'Geri',
    onboarding_next: 'İleri',
    onboarding_done: 'Başla',
    onboarding_closeBackdrop: 'Tanıtımı kapat',
    onboarding_s0_title: 'Yol Arkadaşım’a hoş geldiniz',
    onboarding_s0_body:
      'Eve gidiş-dönüş yolculuğunuz için eşlik uygulaması: harita, topluluk, grup sohbeti ve rota boyunca pratik bilgiler – günlük kullanım ve uzun yol için tasarlandı.',
    onboarding_s1_title: 'Harita ve navigasyon',
    onboarding_s1_body:
      'Rota planlayın, kendinizi ve diğer yolcuları haritada görün, gerektiğinde yardım özelliğini kullanın. Yönünüzü koruyun ve grubunuzla bağlantıda kalın.',
    onboarding_s1_b1: 'Rota: hedef seçin, başlangıcı ayarlayın, çizgiyi takip edin.',
    onboarding_s1_b2: 'İsterseniz konumunuzu paylaşın – yalnızca siz açtığınızda.',
    onboarding_s1_b3: 'SOS/yardım kırmızı düğme ile – hesap olmadan da kullanılabilir.',
    onboarding_s2_title: 'Topluluk',
    onboarding_s2_body:
      'Diğer yolcuların deneyimlerini okuyun ve paylaşın: sınır, mola ve yol üstü konularda ipuçları ve sohbet – her zaman saygılı iletişimle.',
    onboarding_s3_title: 'Gruplar ve konvoy',
    onboarding_s3_body:
      'Grup oluşturun veya katılın, yolda yazışın, hedef ve durumla seyahati koordine edin. Aile, arkadaş veya konvoy için idealdir.',
    onboarding_s4_title: 'Profil ve hesap',
    onboarding_s4_body:
      'Görünen ad, dil, ücretli yol sınıfı ve diğer ayarlar burada. Tüm özellikler için giriş yapın.',
    onboarding_s5_title: 'Yola hazırsınız',
    onboarding_s5_body:
      'Alttan harita, topluluk, gruplar ve profil arasında geçiş yapın. Yardım veya „?“ ile desteğe ulaşın. İyi ve güvenli yolculuklar.',
  },
  en: {
    appTitle: 'Yol Arkadaşım',
    navMap: 'Map',
    navCommunity: 'Community',
    navGroups: 'Groups',
    navProfile: 'Profile',
    login: 'Log in',
    privacyHint: 'i',
    onboarding_kicker: 'Quick tour',
    onboarding_progress: 'Steps',
    onboarding_skip: 'Skip',
    onboarding_back: 'Back',
    onboarding_next: 'Next',
    onboarding_done: 'Get started',
    onboarding_closeBackdrop: 'Close introduction',
    onboarding_s0_title: 'Welcome to Yol Arkadaşım',
    onboarding_s0_body:
      'Your companion for journeys home and back: map, community, group chat, and practical tips along the route—built for everyday use and long drives.',
    onboarding_s1_title: 'Map & navigation',
    onboarding_s1_body:
      'Plan routes, see yourself and fellow travellers on the map, and use help when you need it. Stay oriented and connected with your group.',
    onboarding_s1_b1: 'Routing: pick a destination, adjust the start, follow the line.',
    onboarding_s1_b2: 'Optionally share your position—only when you choose to.',
    onboarding_s1_b3: 'SOS / help via the red control—available even without an account.',
    onboarding_s2_title: 'Community',
    onboarding_s2_body:
      'Read and share experiences: tips and discussion on borders, breaks, and life on the road—always in a respectful tone.',
    onboarding_s3_title: 'Groups & convoy',
    onboarding_s3_body:
      'Create or join groups, chat on the go, and coordinate trips with destination and status. Ideal for family, friends, or convoy travel.',
    onboarding_s4_title: 'Profile & account',
    onboarding_s4_body:
      'Manage display name, language, toll vehicle class, and more here. Sign in to unlock the full feature set.',
    onboarding_s5_title: 'Ready to go',
    onboarding_s5_body:
      'Use the bar below to switch between map, community, groups, and profile. Reach support via help or “?”. We wish you a safe and pleasant journey.',
  },
}
