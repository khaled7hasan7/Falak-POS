import type { LucideIcon } from 'lucide-react'
import { Inbox } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from './cn'

/**
 * الحالة الفارغة — docs/03-design-system.md §6.8
 * «رسم خطي بسيط بلون `--muted` + جملة + **زر الإجراء الأول**».
 *
 * الجملة تقول ما ينقص وما العمل، لا «لا توجد بيانات» وحدها:
 * «لا أصناف بعد — استورد من Excel أو أضف صنفاً».
 */
export interface EmptyStateProps {
  /** أيقونة Lucide خطية (§6.9) */
  icon?: LucideIcon
  title: string
  /** وصف يقول الخطوة التالية */
  description?: string
  /** زر الإجراء الأول — ما يريده المستخدم غالباً */
  action?: ReactNode
  className?: string
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-12 text-center',
        className
      )}
    >
      <Icon aria-hidden className="size-12 text-muted" strokeWidth={1.75} />
      <p className="text-h3 font-semibold text-text">{title}</p>
      {description ? <p className="max-w-md text-small text-soft-2">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}
