import type { PinUser, SessionResponse } from '@falak/contracts'
import { Button, Field, Input } from '@falak/ui'
import { Delete, KeyRound, User } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, api } from '../lib/api'
import { usePrefs } from '../lib/prefs'
import { useSession } from '../lib/session'

/**
 * شاشة الدخول — `docs/01-project-and-permissions.md §5`.
 *
 * بابان: كلمة المرور للمالك والمدير والمحاسب، ولوحة PIN كبيرة للكاشير وأمين
 * المخزن — لأنهما يدخلان عشرات المرات في الوردية أمام الزبون، وكتابة اسم
 * مستخدم وكلمة مرور في كل مرة تكلّف ثوانيَ لا تُحتمل على صندوق مزدحم.
 *
 * أزرار اللوحة `xl` (64px) لتُضغط بالإبهام على شاشة لمس (`docs/03 §6.1`).
 */

const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const
const MIN_PIN = 4
const MAX_PIN = 6

type Mode = 'pin' | 'password'

export function LoginPage() {
  const { t } = usePrefs()
  const { signIn } = useSession()
  const navigate = useNavigate()

  const [mode, setMode] = useState<Mode>('pin')
  const [pinUsers, setPinUsers] = useState<PinUser[] | null>(null)
  const [selected, setSelected] = useState<PinUser | null>(null)
  const [pin, setPin] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const usernameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api
      .get<{ users: PinUser[] }>('/auth/pin-users')
      .then(({ users }) => {
        setPinUsers(users)
        // لا كاشير بـ PIN ⇒ لا فائدة من اللوحة، فتُفتح كلمة المرور مباشرة
        if (users.length === 0) setMode('password')
      })
      .catch((cause: unknown) => {
        setPinUsers([])
        setMode('password')
        setError(cause instanceof ApiError ? cause.message : t('error.serverDown'))
      })
  }, [t])

  useEffect(() => {
    if (mode === 'password') usernameRef.current?.focus()
  }, [mode])

  const submit = async (run: () => Promise<SessionResponse>) => {
    setBusy(true)
    setError(null)
    try {
      signIn(await run())
      navigate('/products', { replace: true })
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('error.unknown'))
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  const submitPin = (value: string) => {
    if (!selected || value.length < MIN_PIN) return
    void submit(() => api.post<SessionResponse>('/auth/pin', { userId: selected.id, pin: value }))
  }

  const pressDigit = (digit: string) => {
    setError(null)
    setPin((current) => (current.length >= MAX_PIN ? current : current + digit))
  }

  const heading = useMemo(() => {
    if (mode === 'password') return t('auth.title')
    return selected ? t('auth.pinPrompt') : t('auth.chooseUser')
  }, [mode, selected, t])

  return (
    <div className="flex min-h-full items-center justify-center bg-page p-6">
      <div className="w-full max-w-login rounded-lg border border-edge bg-box p-6 shadow-2">
        <div className="mb-6 text-center">
          <p className="text-h1 font-bold text-text">{t('app.name')}</p>
          <p className="mt-1 text-small text-soft-2">{t('app.tagline')}</p>
        </div>

        <h2 className="mb-4 text-h3 font-semibold text-text">{heading}</h2>

        {error ? (
          <p
            role="alert"
            aria-live="assertive"
            className="mb-4 rounded border border-danger bg-danger-bg px-4 py-3 text-small text-danger-fg"
          >
            {error}
          </p>
        ) : null}

        {mode === 'pin' ? (
          selected ? (
            <PinPad
              pin={pin}
              busy={busy}
              userName={selected.fullName}
              minPin={MIN_PIN}
              onDigit={pressDigit}
              onBackspace={() => setPin((current) => current.slice(0, -1))}
              onSubmit={() => submitPin(pin)}
              onBack={() => {
                setSelected(null)
                setPin('')
                setError(null)
              }}
              labels={{
                back: t('action.back'),
                clear: t('action.clear'),
                signIn: t('auth.signIn'),
                pin: t('auth.pin'),
              }}
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {(pinUsers ?? []).map((user) => (
                <li key={user.id}>
                  <Button
                    variant="secondary"
                    size="xl"
                    className="w-full justify-start"
                    icon={<User aria-hidden className="size-5" />}
                    onClick={() => setSelected(user)}
                  >
                    <span className="flex flex-col items-start">
                      <span>{user.fullName}</span>
                      <span className="text-small font-normal text-soft-2">
                        {t(`role.${user.roleName}`)}
                      </span>
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          )
        ) : (
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              void submit(() => api.post<SessionResponse>('/auth/login', { username, password }))
            }}
          >
            <Field label={t('auth.username')} required>
              {(props) => (
                <Input
                  {...props}
                  ref={usernameRef}
                  value={username}
                  autoComplete="username"
                  onChange={(event) => setUsername(event.target.value)}
                />
              )}
            </Field>
            <Field label={t('auth.password')} required>
              {(props) => (
                <Input
                  {...props}
                  type="password"
                  value={password}
                  autoComplete="current-password"
                  onChange={(event) => setPassword(event.target.value)}
                />
              )}
            </Field>
            <Button type="submit" size="xl" disabled={busy || !username || !password}>
              {busy ? t('state.loading') : t('auth.signIn')}
            </Button>
          </form>
        )}

        {(pinUsers?.length ?? 0) > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            className="mt-4 w-full"
            icon={<KeyRound aria-hidden className="size-4" />}
            onClick={() => {
              setMode(mode === 'pin' ? 'password' : 'pin')
              setSelected(null)
              setPin('')
              setError(null)
            }}
          >
            {mode === 'pin' ? t('auth.usePassword') : t('auth.usePin')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

interface PinPadProps {
  pin: string
  busy: boolean
  userName: string
  minPin: number
  onDigit: (digit: string) => void
  onBackspace: () => void
  onSubmit: () => void
  onBack: () => void
  labels: { back: string; clear: string; signIn: string; pin: string }
}

function PinPad({
  pin,
  busy,
  userName,
  minPin,
  onDigit,
  onBackspace,
  onSubmit,
  onBack,
  labels,
}: PinPadProps) {
  const pad = useRef<HTMLDivElement>(null)

  // اللوحة تأخذ التركيز عند فتحها فيكتب الكاشير الرمز من لوحة المفاتيح مباشرة (§15)
  useEffect(() => {
    pad.current?.focus()
  }, [])

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (/^\d$/.test(event.key)) {
      event.preventDefault()
      onDigit(event.key)
    } else if (event.key === 'Backspace') {
      event.preventDefault()
      onBackspace()
    } else if (event.key === 'Enter' && pin.length >= minPin) {
      event.preventDefault()
      onSubmit()
    } else if (event.key === 'Escape') {
      onBack()
    }
  }

  return (
    <div
      ref={pad}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="flex flex-col gap-4 outline-none"
      data-testid="pin-pad"
    >
      <p className="text-center text-small text-soft">{userName}</p>

      {/* الرمز مخفي أمام الزبون: نقاط لا أرقام */}
      <div
        className="num flex h-btn-xl items-center justify-center gap-3 rounded border border-edge-strong bg-surface text-h1"
        role="status"
        aria-label={`${labels.pin}: ${pin.length}`}
        data-testid="pin-display"
      >
        {pin.length === 0 ? <span className="text-muted">••••</span> : '•'.repeat(pin.length)}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {KEYPAD.map((digit) => (
          <Button
            key={digit}
            variant="secondary"
            size="xl"
            className="num"
            onClick={() => onDigit(digit)}
            data-testid={`key-${digit}`}
          >
            {digit}
          </Button>
        ))}
        <Button
          variant="ghost"
          size="xl"
          onClick={onBackspace}
          aria-label={labels.clear}
          icon={<Delete aria-hidden className="size-5" />}
        />
        <Button
          variant="secondary"
          size="xl"
          className="num"
          onClick={() => onDigit('0')}
          data-testid="key-0"
        >
          0
        </Button>
        <Button
          size="xl"
          disabled={busy || pin.length < minPin}
          onClick={onSubmit}
          aria-label={labels.signIn}
          data-testid="pin-submit"
        >
          ✓
        </Button>
      </div>

      <Button variant="ghost" size="sm" onClick={onBack}>
        {labels.back}
      </Button>
    </div>
  )
}
