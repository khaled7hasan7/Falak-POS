import type { InputHTMLAttributes, ReactNode } from 'react'
import { useId } from 'react'
import { cn } from './cn'

/**
 * الحقول — docs/03-design-system.md §6.2
 * ارتفاع --h-input (44)، حواف --r-md (10)، حد --edge-strong، خلفية --box.
 * التركيز: حد --primary + حلقة 3px بلون falak-500/15 (3px من قائمة استثناءات الحارس).
 * الأرقام والمبالغ: `num` (Space Grotesk، LTR، محاذاة النهاية داخل عزل LTR = يمين).
 */
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** حقل رقم/مبلغ/باركود: يأخذ صنف `num` (§7). */
  numeric?: boolean
  /** يرسم الحقل بحالة الخطأ؛ الرسالة نفسها من مكوّن Field. */
  invalid?: boolean
  /** أيقونة Lucide في بداية الحقل (بحث، ماسح…) — §6.2 */
  icon?: ReactNode
}

export function Input({ numeric, invalid, icon, className, ...rest }: InputProps) {
  const field = (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        'h-input w-full rounded border border-edge-strong bg-box px-4 text-ui text-text',
        'placeholder:text-muted',
        'focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-falak-500/15 focus:ring-offset-0',
        'disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted',
        numeric && 'num text-end',
        invalid && 'border-danger',
        icon && 'ps-8',
        className
      )}
      {...rest}
    />
  )

  if (!icon) return field
  return (
    <span className="relative block">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-muted"
      >
        {icon}
      </span>
      {field}
    </span>
  )
}

export interface FieldProps {
  /** التسمية فوق الحقل (§6.2). */
  label: string
  /**
   * رسالة الخطأ: تقول **ما المشكلة وكيف تُحل** (§6.2 و§7)،
   * مثل: «الكمية أكبر من المخزون (المتاح 3). قلّل الكمية أو فعّل البيع بالسالب من الإعدادات.»
   */
  error?: string
  /** تلميح تحت الحقل يظهر عند غياب الخطأ. */
  hint?: string
  required?: boolean
  /** يُستدعى بمعرّفات الربط ليمرّرها المستهلك للحقل. */
  children: (props: {
    id: string
    'aria-describedby': string | undefined
    invalid: boolean
  }) => ReactNode
}

export function Field({ label, error, hint, required, children }: FieldProps) {
  const id = useId()
  const messageId = `${id}-message`
  const message = error ?? hint

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-small font-medium text-soft">
        {label}
        {required ? (
          <span aria-hidden className="text-danger-fg">
            *
          </span>
        ) : null}
      </label>
      {children({
        id,
        'aria-describedby': message ? messageId : undefined,
        invalid: Boolean(error),
      })}
      {message ? (
        <p
          id={messageId}
          role={error ? 'alert' : undefined}
          aria-live={error ? 'polite' : undefined}
          className={cn('text-small', error ? 'text-danger-fg' : 'text-soft-2')}
        >
          {message}
        </p>
      ) : null}
    </div>
  )
}
