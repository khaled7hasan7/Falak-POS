import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'
import { cn } from './cn'

/** الجداول الطويلة تُصفَّح 50 صفاً (docs/03-design-system.md §6.4). */
export const ROWS_PER_PAGE = 50

export interface Column<T> {
  key: string
  header: string
  /** عمود مبالغ/أرقام: صنف `num` + محاذاة النهاية + بلا التفاف (§6.4). */
  numeric?: boolean
  /** الأعمدة الأقل أهمية تختفي أولاً على الشاشات الضيقة (§6.4). */
  hideBelow?: 'sm' | 'md' | 'lg'
  cell: (row: T) => ReactNode
}

const HIDE_BELOW = {
  sm: 'max-sm:hidden',
  md: 'max-md:hidden',
  lg: 'max-lg:hidden',
} as const

export interface TableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T, index: number) => string
  /** صف الإجمالي أسفل الجدول: القيمة لكل مفتاح عمود (§6.4). */
  totalRow?: Record<string, ReactNode>
  /** يظهر مكان الجسم عندما لا توجد صفوف — مرّر <EmptyState /> (§6.8). */
  emptyState?: ReactNode
  pageSize?: number
  /** نصوص من @falak/i18n؛ الافتراضي إنجليزي لتفادي نص عربي مكتوب في الكود. */
  labels?: { previous?: string; next?: string }
  caption?: string
  className?: string
}

export function Table<T>({
  columns,
  rows,
  rowKey,
  totalRow,
  emptyState,
  pageSize = ROWS_PER_PAGE,
  labels,
  caption,
  className,
}: TableProps<T>) {
  const [page, setPage] = useState(0)
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const current = Math.min(page, pages - 1)
  const visible = useMemo(
    () => rows.slice(current * pageSize, current * pageSize + pageSize),
    [rows, current, pageSize]
  )

  const cellClass = (column: Column<T>) =>
    cn(
      'px-4 py-3 text-start align-middle',
      column.numeric && 'num whitespace-nowrap text-end',
      column.hideBelow && HIDE_BELOW[column.hideBelow]
    )

  return (
    <div className={cn('rounded-[12px] border border-edge bg-box', className)}>
      {/* الجدول يتمرّر أفقياً داخل حاويته لا في الصفحة (§15) */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-small text-text">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead className="bg-surface">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    cellClass(column),
                    'text-label font-medium uppercase tracking-[.14em] text-muted'
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="p-6">
                  {emptyState}
                </td>
              </tr>
            ) : (
              visible.map((row, index) => (
                <tr
                  key={rowKey(row, index)}
                  className="border-t border-edge hover:bg-[color:var(--unread)]"
                >
                  {columns.map((column) => (
                    <td key={column.key} className={cellClass(column)}>
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          {totalRow ? (
            <tfoot>
              <tr className="border-t border-edge bg-surface font-semibold">
                {columns.map((column) => (
                  <td key={column.key} className={cellClass(column)}>
                    {totalRow[column.key]}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {pages > 1 ? (
        <div className="flex items-center justify-between gap-2 border-t border-edge px-4 py-3">
          <PagerButton
            label={labels?.previous ?? 'Previous'}
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            {/* أيقونات الاتجاه تُقلب في RTL (§6.9) */}
            <ChevronRight aria-hidden className="size-4 rtl:-scale-x-100" />
          </PagerButton>
          <span className="num text-small text-soft-2">
            {current + 1} / {pages}
          </span>
          <PagerButton
            label={labels?.next ?? 'Next'}
            disabled={current >= pages - 1}
            onClick={() => setPage(current + 1)}
          >
            <ChevronLeft aria-hidden className="size-4 rtl:-scale-x-100" />
          </PagerButton>
        </div>
      ) : null}
    </div>
  )
}

function PagerButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-btn-sm items-center justify-center rounded-sm border border-edge-strong bg-box px-3 text-soft',
        'hover:bg-falak-50 disabled:cursor-not-allowed disabled:bg-surface disabled:text-muted',
        'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-falak-500/35 focus-visible:outline-offset-2'
      )}
    >
      {children}
    </button>
  )
}
