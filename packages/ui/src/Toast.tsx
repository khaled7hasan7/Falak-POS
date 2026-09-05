import { AlertTriangle, Check, Info, X, XCircle } from 'lucide-react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { cn } from './cn'

/**
 * التنبيهات — docs/03-design-system.md §6.8
 * «أسفل اليسار (في RTL)، 4 ثوانٍ، بلون دلالي وأيقونة، **زر تراجع عند الإمكان**».
 *
 * زر التراجع ليس زينة: «أُلغيت الفاتورة · تراجع» هو ما يحوّل خطأ الكاشير من
 * كارثة إلى نقرة. أي عملية قابلة للعكس يجب أن تعرض التراجع هنا.
 *
 * إمكانية الوصول (§12): الحاوية `aria-live` — `assertive` للخطأ لأنه يوقف العمل،
 * و`polite` لغيره فلا يقاطع قارئ الشاشة أثناء الكتابة.
 */

export const TOAST_TONES = ['ok', 'warn', 'bad', 'info'] as const
export type ToastTone = (typeof TOAST_TONES)[number]

/** مدة العرض الافتراضية (§6.8: أربع ثوانٍ) */
export const TOAST_DURATION_MS = 4000

export interface ToastOptions {
  message: string
  tone?: ToastTone
  /** نص زر التراجع ودالته — يظهران معاً أو لا يظهران */
  undoLabel?: string
  onUndo?: () => void
  durationMs?: number
}

interface ToastItem extends ToastOptions {
  id: number
}

interface ToastContextValue {
  /** يعرض تنبيهاً ويعيد معرّفه */
  toast: (options: ToastOptions) => number
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

/** يستدعيها أي مكوّن ليعرض تنبيهاً. يرمي خطأً واضحاً خارج المزوّد. */
export function useToast(): ToastContextValue {
  const value = useContext(ToastContext)
  if (!value) {
    throw new Error('useToast يحتاج <ToastProvider> أعلى الشجرة')
  }
  return value
}

const TONE_ICON = {
  ok: Check,
  warn: AlertTriangle,
  bad: XCircle,
  info: Info,
} as const

const TONE_CLASS = {
  ok: 'bg-ok-bg text-ok-fg',
  warn: 'bg-warn-bg text-warn-fg',
  bad: 'bg-danger-bg text-danger-fg',
  info: 'bg-info-bg text-info-fg',
} as const

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id))
  }, [])

  const toast = useCallback((options: ToastOptions) => {
    const id = nextId.current++
    setItems((current) => [...current, { ...options, id }])
    return id
  }, [])

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        // أسفل البداية: في RTL يسار، وفي LTR يمين — خاصية منطقية لا left/right (§7)
        className="pointer-events-none fixed bottom-4 start-4 z-50 flex flex-col gap-2"
        role="region"
      >
        {items.map((item) => (
          <ToastCard key={item.id} item={item} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const tone = item.tone ?? 'info'
  const Icon = TONE_ICON[tone]
  const duration = item.durationMs ?? TOAST_DURATION_MS

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(item.id), duration)
    return () => clearTimeout(timer)
  }, [item.id, duration, onDismiss])

  return (
    <div
      // الخطأ يقاطع، وغيره ينتظر دوره (§12)
      aria-live={tone === 'bad' ? 'assertive' : 'polite'}
      className={cn(
        'pointer-events-auto flex items-center gap-3 rounded-lg px-4 py-3 shadow-2',
        TONE_CLASS[tone]
      )}
    >
      <Icon aria-hidden className="size-5 shrink-0" />
      <span className="text-ui">{item.message}</span>

      {item.onUndo && item.undoLabel ? (
        <button
          type="button"
          className="rounded-sm px-2 py-1 text-ui font-semibold underline underline-offset-2"
          onClick={() => {
            item.onUndo?.()
            onDismiss(item.id)
          }}
        >
          {item.undoLabel}
        </button>
      ) : null}

      <button
        type="button"
        aria-label="إغلاق التنبيه"
        className="rounded-sm p-1"
        onClick={() => onDismiss(item.id)}
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  )
}
