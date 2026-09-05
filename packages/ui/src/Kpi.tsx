import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from './cn'

/**
 * بطاقة الرقم (KPI) — docs/03-design-system.md §6.5
 * حواف 12، padding 14 16: تسمية → رقم num-lg → سطر فرعي.
 *
 * **`hot` واحدة فقط في الشاشة** (§1: «رقم واحد مهم يُبرَز»). البطاقة المتدرّجة
 * تفقد معناها لو تكرّرت، فلا تضع أكثر من واحدة مهما بدا الرقمان مهمّين.
 */
export interface KpiProps extends HTMLAttributes<HTMLDivElement> {
  label: string
  /** الرقم — يُعرض بصنف `num` (Space Grotesk, LTR, tabular) حتى داخل واجهة RTL (§7) */
  value: ReactNode
  /** سطر فرعي: مقارنة بالفترة السابقة، أو وحدة القياس */
  hint?: ReactNode
  /** البطاقة المتدرّجة — واحدة في الشاشة */
  hot?: boolean
}

export function Kpi({ label, value, hint, hot = false, className, ...rest }: KpiProps) {
  return (
    <div
      className={cn(
        'rounded-[12px] border border-edge p-4',
        hot
          ? 'border-transparent bg-gradient-to-br from-falak-900 via-falak-700 to-falak-500 text-white'
          : 'bg-box',
        className
      )}
      {...rest}
    >
      <div className={cn('text-small', hot ? 'text-falak-200' : 'text-soft-2')}>{label}</div>
      <div className="num mt-1 text-num-lg font-bold">{value}</div>
      {hint ? (
        <div className={cn('mt-1 text-small', hot ? 'text-falak-200' : 'text-muted')}>{hint}</div>
      ) : null}
    </div>
  )
}
