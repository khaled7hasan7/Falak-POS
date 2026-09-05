import { Button } from '@falak/ui'
import { Languages, LogOut, Moon, Sun } from 'lucide-react'
import type { ReactNode } from 'react'
import { usePrefs } from '../lib/prefs'
import { useSession } from '../lib/session'

/**
 * شريط العنوان — `docs/03-design-system.md §5.1`: ارتفاع 56، عنوان الصفحة
 * في البداية والإجراءات في النهاية. تبديل اللغة والمظهر هنا لأنه يخصّ الجلسة
 * كلها لا شاشة بعينها، ويُحفظ لكل مستخدم (`lib/prefs`).
 */

export interface TopbarProps {
  title: string
  /** إجراءات الشاشة الحالية — تسبق أزرار الجلسة */
  actions?: ReactNode
}

export function Topbar({ title, actions }: TopbarProps) {
  const { t, locale, setLocale, theme, resolvedTheme, setTheme } = usePrefs()
  const { signOut, user } = useSession()

  const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark'
  const themeLabel =
    theme === 'system'
      ? t('settings.themeSystem')
      : theme === 'dark'
        ? t('settings.themeDark')
        : t('settings.themeLight')

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-edge bg-box px-6">
      <h1 className="text-h2 font-semibold text-text">{title}</h1>
      <div className="ms-auto flex items-center gap-2">
        {actions}
        <Button
          variant="ghost"
          size="sm"
          icon={<Languages aria-hidden className="size-4" />}
          onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
          aria-label={t('settings.language')}
          title={t('settings.language')}
        >
          {locale === 'ar' ? 'EN' : 'ع'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon={
            resolvedTheme === 'dark' ? (
              <Sun aria-hidden className="size-4" />
            ) : (
              <Moon aria-hidden className="size-4" />
            )
          }
          onClick={() => setTheme(nextTheme)}
          aria-label={`${t('settings.theme')}: ${themeLabel}`}
          title={`${t('settings.theme')}: ${themeLabel}`}
        />
        {user ? (
          <Button
            variant="ghost"
            size="sm"
            icon={<LogOut aria-hidden className="size-4" />}
            onClick={signOut}
          >
            {t('auth.signOut')}
          </Button>
        ) : null}
      </div>
    </header>
  )
}
