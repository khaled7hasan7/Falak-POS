import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { cn } from './cn'

/**
 * النوافذ الحوارية — docs/03-design-system.md §6.7
 * خلفية معتمة falak-950/55 + blur 2px، النافذة --box حواف --r-lg وظل --shadow-2.
 * العروض 480 (sm) / 640 (md) / 960 (lg) — القيم الثلاث في قائمة استثناءات الحارس.
 * Esc يغلق، Enter يؤكد. الحركة fade + scale .96→1 خلال 150ms (§11)،
 * ويعطّلها `prefers-reduced-motion` من tokens.css.
 */
const SIZE = {
  sm: 'max-w-[480px]',
  md: 'max-w-[640px]',
  lg: 'max-w-[960px]',
} as const

export type DialogSize = keyof typeof SIZE

export interface DialogProps {
  open: boolean
  onClose: () => void
  /** يُستدعى عند Enter وعند زر التأكيد في التذييل. */
  onConfirm?: () => void
  title: string
  /** نص aria-label لزر الإغلاق — من @falak/i18n. */
  closeLabel?: string
  size?: DialogSize
  /** أزرار التذييل: الأساسي آخر عنصر ليقع في أقصى النهاية (اليسار في RTL) — §6.7. */
  footer?: ReactNode
  children?: ReactNode
}

export function Dialog({
  open,
  onClose,
  onConfirm,
  title,
  closeLabel = 'Close',
  size = 'sm',
  footer,
  children,
}: DialogProps) {
  const panel = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (!open) {
      setShown(false)
      return
    }
    const frame = requestAnimationFrame(() => {
      setShown(true)
      panel.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Enter' || !onConfirm || event.isComposing) return
      // Enter لا يُصادر أزرار التذييل ولا النص متعدد الأسطر
      const target = event.target as HTMLElement | null
      if (target?.tagName === 'TEXTAREA' || target?.tagName === 'BUTTON') return
      event.preventDefault()
      onConfirm()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose, onConfirm])

  if (!open) return null

  return (
    <div
      data-testid="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center p-4',
        'bg-falak-950/55 backdrop-blur-[2px]',
        'transition-opacity duration-150',
        shown ? 'opacity-100' : 'opacity-0'
      )}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'w-full rounded-lg bg-box shadow-2 outline-none',
          'transition-transform duration-150',
          shown ? 'scale-100' : 'scale-[.96]',
          SIZE[size]
        )}
      >
        <header className="flex items-center justify-between gap-3 border-b border-edge px-6 py-3">
          <h2 className="text-h2 font-semibold text-text">{title}</h2>
          <button
            type="button"
            aria-label={closeLabel}
            onClick={onClose}
            className={cn(
              'inline-flex size-8 items-center justify-center rounded-sm text-soft-2',
              'hover:bg-surface focus-visible:outline focus-visible:outline-[3px]',
              'focus-visible:outline-falak-500/35 focus-visible:outline-offset-2'
            )}
          >
            <X aria-hidden className="size-4" />
          </button>
        </header>
        <div className="p-6">{children}</div>
        {footer ? (
          <footer className="flex items-center justify-end gap-2 border-t border-edge px-6 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  )
}

/** نافذة PIN المدير: ست خانات كبيرة، رقم واحد لكل خانة (§6.7 و docs/01 §5). */
export const PIN_LENGTH = 6

export interface PinDialogProps {
  open: boolean
  onClose: () => void
  /** يُستدعى فور اكتمال الأرقام الستة، ثم تُغلق النافذة تلقائياً (§6.7). */
  onComplete: (pin: string) => void
  title: string
  /** aria-label لكل خانة (يُلحق به رقم الخانة) — من @falak/i18n. */
  digitLabel?: string
  closeLabel?: string
  /** رسالة خطأ تقول ما المشكلة وكيف تُحل (§7). */
  error?: string
}

export function PinDialog({
  open,
  onClose,
  onComplete,
  title,
  digitLabel = 'PIN digit',
  closeLabel,
  error,
}: PinDialogProps) {
  const [digits, setDigits] = useState<string[]>(() => Array<string>(PIN_LENGTH).fill(''))
  const boxes = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => {
    if (!open) return
    setDigits(Array<string>(PIN_LENGTH).fill(''))
    const frame = requestAnimationFrame(() => boxes.current[0]?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])

  const setDigit = (index: number, raw: string) => {
    const digit = raw.replace(/\D/g, '').slice(-1)
    const next = [...digits]
    next[index] = digit
    setDigits(next)
    if (digit && index < PIN_LENGTH - 1) boxes.current[index + 1]?.focus()
    if (next.every((value) => value !== '')) {
      onComplete(next.join(''))
      onClose()
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={title} closeLabel={closeLabel} size="sm">
      <div className="flex flex-col gap-3">
        <div className="num flex items-center justify-center gap-2">
          {digits.map((digit, index) => (
            <input
              // الخانات ثابتة العدد والترتيب فلا مفتاح أفضل من الفهرس
              key={index}
              ref={(element) => {
                boxes.current[index] = element
              }}
              value={digit}
              onChange={(event) => setDigit(index, event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Backspace' && !digit && index > 0) {
                  boxes.current[index - 1]?.focus()
                }
              }}
              type="password"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={1}
              aria-label={`${digitLabel} ${index + 1}`}
              data-testid={`pin-digit-${index}`}
              className={cn(
                'num h-btn-xl w-12 rounded border border-edge-strong bg-box text-center text-h1 text-text',
                'focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-falak-500/15',
                error && 'border-danger'
              )}
            />
          ))}
        </div>
        {error ? (
          <p role="alert" aria-live="polite" className="text-center text-small text-danger-fg">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}
