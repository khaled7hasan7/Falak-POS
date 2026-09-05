import type { BusinessType, Locale, Translator } from '@falak/i18n'
import { DEFAULT_LOCALE, LOCALES, createTranslator, getDirection } from '@falak/i18n'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

/**
 * تفضيلات العرض: اللغة والمظهر — **محفوظة لكل مستخدم** (المهمة 1.6).
 *
 * تبديل اللغة يقلب `document.dir` كاملاً (`docs/03 §7`)، والمظهر يكتب
 * `data-theme` على الجذر وهو ما يقرأه `tokens.css` و`darkMode` في preset تايلوند.
 * `system` يتبع تفضيل الجهاز حياً — لا لحظة الإقلاع فقط.
 */

export const THEMES = ['light', 'dark', 'system'] as const
export type Theme = (typeof THEMES)[number]

export interface Prefs {
  locale: Locale
  theme: Theme
}

const DEFAULT_PREFS: Prefs = { locale: DEFAULT_LOCALE, theme: 'system' }

/** مفتاح التخزين لكل مستخدم — مستخدمان على جهاز واحد لا يتشاركان التفضيل */
function storageKey(userId: string | null): string {
  return userId ? `falak.prefs.${userId}` : 'falak.prefs.guest'
}

function readPrefs(userId: string | null): Prefs {
  try {
    const raw = localStorage.getItem(storageKey(userId))
    if (!raw) return DEFAULT_PREFS
    const parsed = JSON.parse(raw) as Partial<Prefs>
    return {
      locale: LOCALES.includes(parsed.locale as Locale) ? (parsed.locale as Locale) : DEFAULT_LOCALE,
      theme: THEMES.includes(parsed.theme as Theme) ? (parsed.theme as Theme) : 'system',
    }
  } catch {
    return DEFAULT_PREFS
  }
}

/** المظهر الفعلي بعد حلّ `system` */
function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export interface PrefsContextValue extends Prefs {
  t: Translator
  dir: 'rtl' | 'ltr'
  resolvedTheme: 'light' | 'dark'
  setLocale: (locale: Locale) => void
  setTheme: (theme: Theme) => void
}

const PrefsContext = createContext<PrefsContextValue | null>(null)

export function usePrefs(): PrefsContextValue {
  const value = useContext(PrefsContext)
  if (!value) throw new Error('usePrefs يحتاج <PrefsProvider> أعلى الشجرة')
  return value
}

/** اختصار للمكوّنات التي لا تحتاج إلا الترجمة */
export function useT(): Translator {
  return usePrefs().t
}

export interface PrefsProviderProps {
  userId: string | null
  /** نوع النشاط يغيّر المصطلحات: «صنف» تصير «دواء» في الصيدلية (docs/01 §4) */
  businessType?: BusinessType
  children: ReactNode
}

export function PrefsProvider({ userId, businessType = 'supermarket', children }: PrefsProviderProps) {
  const [prefs, setPrefs] = useState<Prefs>(() => readPrefs(userId))
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )

  // تبديل المستخدم يعيد تحميل تفضيلاته هو
  useEffect(() => {
    setPrefs(readPrefs(userId))
  }, [userId])

  // `system` يتبع الجهاز حياً لا لحظة الإقلاع
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [])

  const resolvedTheme: 'light' | 'dark' =
    prefs.theme === 'system' ? (systemDark ? 'dark' : 'light') : prefs.theme
  const dir = getDirection(prefs.locale)

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('lang', prefs.locale)
    root.setAttribute('dir', dir)
    root.setAttribute('data-theme', resolvedTheme)
  }, [prefs.locale, dir, resolvedTheme])

  const persist = useCallback(
    (next: Prefs) => {
      setPrefs(next)
      try {
        localStorage.setItem(storageKey(userId), JSON.stringify(next))
      } catch {
        // متصفح يمنع التخزين: التفضيل يبقى للجلسة الحالية ولا يسقط التطبيق
      }
    },
    [userId]
  )

  const value = useMemo<PrefsContextValue>(
    () => ({
      ...prefs,
      dir,
      resolvedTheme,
      t: createTranslator({ locale: prefs.locale, businessType }),
      setLocale: (locale) => persist({ ...prefs, locale }),
      setTheme: (theme) => persist({ ...prefs, theme }),
    }),
    [prefs, dir, resolvedTheme, businessType, persist]
  )

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>
}

export { resolveTheme }
