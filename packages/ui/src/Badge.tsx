import { cva, type VariantProps } from 'class-variance-authority'
import { Check } from 'lucide-react'
import type { HTMLAttributes } from 'react'
import { cn } from './cn'

/**
 * الشارات — docs/03-design-system.md §6.3
 * pill، نقطة 6px قبل النص بلون النص. الحالة تُقرأ من اللون **والشكل** معاً (§2.2).
 * قرار ثابت: `b-ok` تستبدل النقطة بأيقونة ✓ لأن لونها أزرق مثل info، فبلا الأيقونة
 * لا يفرّق الكاشير بين «مدفوع» و«مسودّة» — ولا يوجد أخضر في النظام (§2.2).
 */
const badge = cva(
  'inline-flex items-center gap-1 rounded-pill px-2 py-1 text-label font-semibold',
  {
    variants: {
      tone: {
        ok: 'b-ok bg-ok-bg text-ok-fg',
        warn: 'b-warn bg-warn-bg text-warn-fg',
        bad: 'b-bad bg-danger-bg text-danger-fg',
        info: 'b-info bg-info-bg text-info-fg',
        neutral: 'b-neutral bg-surface text-soft',
      },
    },
    defaultVariants: { tone: 'neutral' },
  }
)

export type BadgeTone = NonNullable<VariantProps<typeof badge>['tone']>

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badge> {}

export function Badge({ tone = 'neutral', className, children, ...rest }: BadgeProps) {
  return (
    <span className={cn(badge({ tone }), className)} {...rest}>
      {tone === 'ok' ? (
        <Check aria-hidden data-testid="badge-check" className="size-4" />
      ) : (
        // النقطة 6px (§6.3) — 6px من قائمة استثناءات اختبار الحارس
        <span aria-hidden data-testid="badge-dot" className="size-[6px] rounded-pill bg-current" />
      )}
      {children}
    </span>
  )
}
