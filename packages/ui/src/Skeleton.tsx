import type { HTMLAttributes } from 'react'
import { cn } from './cn'

/**
 * هيكل التحميل — docs/03-design-system.md §6.8
 * «هيكل (skeleton) بلون `--surface` نابض، **لا سبينر في الجداول**»: الهيكل يحفظ
 * تخطيط الصفحة فلا ترتجّ عند وصول البيانات، والسبينر لا يفعل.
 *
 * النبض يتوقّف تلقائياً مع `prefers-reduced-motion` (§11).
 */
export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** عدد الأسطر — لمحاكاة فقرة أو صفوف جدول */
  lines?: number
}

export function Skeleton({ lines = 1, className, ...rest }: SkeletonProps) {
  if (lines === 1) {
    return (
      <div
        aria-hidden
        className={cn('h-4 animate-pulse rounded-sm bg-surface', className)}
        {...rest}
      />
    )
  }

  return (
    <div aria-hidden className="flex flex-col gap-2" {...rest}>
      {Array.from({ length: lines }, (_, index) => (
        <div
          key={index}
          className={cn(
            'h-4 animate-pulse rounded-sm bg-surface',
            // السطر الأخير أقصر — يشبه نصاً حقيقياً أكثر
            index === lines - 1 && 'w-2/3',
            className
          )}
        />
      ))}
    </div>
  )
}

/** هيكل صفوف جدول — يُعرض داخل `<tbody>` بدل السبينر (§6.8) */
export function SkeletonRows({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <tr key={rowIndex} className="border-t border-edge">
          {Array.from({ length: columns }, (_, columnIndex) => (
            <td key={columnIndex} className="px-4 py-3">
              <Skeleton />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}
