import type { SessionResponse, SessionUser } from '@falak/contracts'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api, setAuthToken, setUnauthenticatedHandler } from './api'

/**
 * الجلسة المحلية: رمز JWT من الوكيل + المستخدم وصلاحياته.
 *
 * القاعدة 6 في `CLAUDE.md`: **الصلاحيات تُفحص في الخادم دائماً، والواجهة تخفي فقط.**
 * لذلك `can()` هنا لإخفاء زر لا يعمل، لا لحماية شيء — الوكيل يرد 403 على أي حال.
 */

const STORAGE_KEY = 'falak.session'

interface StoredSession {
  token: string
  expiresAt: string
  user: SessionUser
}

function readStored(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredSession
    // جلسة منتهية لا تُحمَّل: الوكيل سيرفضها وتظهر شاشة خطأ بدل شاشة دخول
    if (new Date(parsed.expiresAt).getTime() <= Date.now()) return null
    return parsed
  } catch {
    return null
  }
}

export interface SessionContextValue {
  user: SessionUser | null
  /** هل يملك المستخدم هذه الصلاحية — للإخفاء فقط، لا للحماية */
  can: (permission: string) => boolean
  signIn: (response: SessionResponse) => void
  signOut: () => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession يحتاج <SessionProvider> أعلى الشجرة')
  return value
}

/**
 * فحص الصلاحية بنفس منطق `can()` في الوكيل: الصلاحية بلا حدّ تغطّي أي حدّ،
 * والمحدودة تغطّي حدّاً أصغر أو مساوياً — نسخة عرض لا نسخة قرار.
 */
export function hasPermission(granted: readonly string[], required: string): boolean {
  const split = (value: string) => {
    const at = value.indexOf(':')
    return at === -1
      ? { name: value, limit: null as number | null }
      : { name: value.slice(0, at), limit: Number(value.slice(at + 1)) }
  }
  const want = split(required)
  return granted.some((held) => {
    const have = split(held)
    if (have.name !== want.name) return false
    if (have.limit === null) return true
    if (want.limit === null) return false
    return have.limit >= want.limit
  })
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<StoredSession | null>(() => {
    const initial = readStored()
    if (initial) setAuthToken(initial.token)
    return initial
  })

  const signIn = useCallback((response: SessionResponse) => {
    const next: StoredSession = {
      token: response.token,
      expiresAt: response.expiresAt,
      user: response.user,
    }
    setAuthToken(next.token)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    setStored(next)
  }, [])

  const signOut = useCallback(() => {
    setAuthToken(null)
    localStorage.removeItem(STORAGE_KEY)
    setStored(null)
  }, [])

  // 401 من أي طلب ⇒ إنهاء الجلسة، فيعود المستخدم للدخول بدل شاشة خطأ صامتة
  useEffect(() => {
    setUnauthenticatedHandler(signOut)
    return () => setUnauthenticatedHandler(null)
  }, [signOut])

  const value = useMemo<SessionContextValue>(
    () => ({
      user: stored?.user ?? null,
      can: (permission) => hasPermission(stored?.user.role.permissions ?? [], permission),
      signIn,
      signOut,
    }),
    [stored, signIn, signOut]
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

/** يستأنف الجلسة المخزّنة بسؤال الوكيل — يكشف رمزاً أُبطل من الخادم */
export async function verifyStoredSession(): Promise<boolean> {
  try {
    await api.get('/auth/me')
    return true
  } catch {
    return false
  }
}
