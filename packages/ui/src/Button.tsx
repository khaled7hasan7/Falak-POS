import { cva, type VariantProps } from 'class-variance-authority'
import { MessageCircle } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'

/**
 * الأزرار — docs/03-design-system.md §6.1
 * الارتفاعات من tokens: md=--h-btn (44)، sm=--h-btn-sm (36)، xl=--h-btn-xl (64، لمس الكاشير).
 * التركيز: outline 3px بلون falak-500/35 (§6.1) — 3px من قائمة الاستثناءات في اختبار الحارس.
 * `btn-pay` ليس صنفاً مستقلاً: هو primary بحجم xl (§6.1) فلا نكرّره.
 */
const button = cva(
  [
    'inline-flex items-center justify-center gap-2 font-semibold',
    'transition-[transform,box-shadow,background-color] duration-[120ms]',
    'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-falak-500/35 focus-visible:outline-offset-2',
    'disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted disabled:shadow-none disabled:translate-y-0',
  ].join(' '),
  {
    variants: {
      variant: {
        primary: 'bg-primary text-white shadow-blue hover:-translate-y-px',
        secondary:
          'bg-box text-text border border-edge-strong hover:bg-falak-50 hover:text-falak-700',
        ghost: 'bg-transparent text-primary hover:bg-info-bg',
        danger: 'bg-danger-bg text-danger-fg',
        /** على الخلفيات الليلية: أبيض على falak-900 (§6.1) */
        night: 'bg-white text-falak-900',
        /** واتساب = زر ثانوي بأيقونة رمادية، بلا أخضر إطلاقاً (§2.2 و§6.1) */
        wa: 'bg-box text-text border border-edge-strong hover:bg-falak-50',
      },
      size: {
        sm: 'h-btn-sm rounded-sm px-3 text-small',
        md: 'h-btn rounded px-4 text-ui',
        xl: 'h-btn-xl rounded px-6 text-h2 font-bold',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  }
)

export type ButtonVariant = NonNullable<VariantProps<typeof button>['variant']>
export type ButtonSize = NonNullable<VariantProps<typeof button>['size']>

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {
  /** اختصار لوحة المفاتيح يُعرض داخل الزر كـ <kbd> صغير: «F8 · ادفع» (§6.1). */
  kbd?: string
  /** أيقونة Lucide اختيارية قبل النص (§6.9). */
  icon?: ReactNode
}

export function Button({ variant, size, kbd, icon, className, children, ...rest }: ButtonProps) {
  return (
    <button type="button" className={cn(button({ variant, size }), className)} {...rest}>
      {kbd ? (
        <kbd className="num rounded-xs border border-current/30 px-1 text-label opacity-70">
          {kbd}
        </kbd>
      ) : null}
      {variant === 'wa' ? <MessageCircle aria-hidden className="size-4 text-muted" /> : icon}
      {children}
    </button>
  )
}
