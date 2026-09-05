import type { HTMLAttributes } from 'react'
import { cn } from './cn'

/**
 * الوسوم — docs/03-design-system.md §6.3
 * حواف --r-xs (6)، Space Grotesk uppercase، للأكواد والأدوار والوحدات
 * (`credit`, `Owner`, `EAN-13`). صنف `num` يعطي الخط واتجاه LTR داخل واجهة RTL (§7).
 */
export type TagProps = HTMLAttributes<HTMLSpanElement>

export function Tag({ className, children, ...rest }: TagProps) {
  return (
    <span
      className={cn(
        'num inline-flex items-center rounded-xs border border-edge bg-surface px-2 py-1',
        'text-label font-medium uppercase tracking-[.06em] text-soft-2',
        className
      )}
      {...rest}
    >
      {children}
    </span>
  )
}
