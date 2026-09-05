import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from './cn'

/**
 * القائمة الجانبية — docs/03-design-system.md §6.6
 *
 * **ليلية في الوضعين الفاتح والداكن** (§10): لا تتبع المظهر، لأنها هوية بصرية
 * ثابتة لا عنصر واجهة. عرضها 220 من الـ token `--w-sidebar`، وفي RTL تقع على
 * اليمين تلقائياً لأن التخطيط يستعمل خصائص منطقية (§5.1 و§7).
 *
 * التدرّج `#071229 → #03070F` هو falak-900 → falak-950 من الـ tokens (§2.1).
 */

export interface SidebarItem {
  key: string
  label: string
  icon?: LucideIcon
  /** عدّاد يظهر كـ pill أزرق (تنبيهات، عناصر بانتظار) */
  count?: number
}

export interface SidebarProps {
  items: SidebarItem[]
  activeKey?: string
  onSelect?: (key: string) => void
  /** الشعار: النسخة البيضاء فقط على الليل (§13) */
  logo?: ReactNode
  title?: string
  /** بطاقة المستخدم أسفل القائمة */
  user?: { fullName: string; roleLabel: string }
  footer?: ReactNode
  className?: string
}

export function Sidebar({
  items,
  activeKey,
  onSelect,
  logo,
  title = 'Falak POS',
  user,
  footer,
  className,
}: SidebarProps) {
  return (
    <nav
      aria-label={title}
      className={cn(
        'flex w-sidebar shrink-0 flex-col bg-gradient-to-b from-falak-900 to-falak-950 px-3.5 py-4',
        className
      )}
    >
      <div className="mb-4 flex items-center gap-2 px-2">
        {logo}
        <span className="text-h2 font-semibold text-white">{title}</span>
      </div>

      <ul className="flex flex-1 flex-col gap-1">
        {items.map((item) => {
          const isActive = item.key === activeKey
          const Icon = item.icon
          return (
            <li key={item.key}>
              <button
                type="button"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => onSelect?.(item.key)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-[9px] px-3 py-2.5 text-start text-ui',
                  'transition-colors duration-[120ms]',
                  isActive
                    ? 'border-s-[3px] border-falak-400 bg-primary/20 font-semibold text-white'
                    : 'text-falak-200/70 hover:bg-primary/10 hover:text-white'
                )}
              >
                {Icon ? <Icon aria-hidden className="size-5 shrink-0" /> : null}
                <span className="flex-1 truncate">{item.label}</span>
                {item.count !== undefined && item.count > 0 ? (
                  <span className="num rounded-pill bg-primary px-2 py-0.5 text-label font-semibold text-white">
                    {item.count}
                  </span>
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>

      {user ? (
        <div className="mt-4 flex items-center gap-2 border-t border-glow/15 pt-3">
          <span
            aria-hidden
            className="flex size-[30px] shrink-0 items-center justify-center rounded-pill bg-primary text-ui font-semibold text-white"
          >
            {user.fullName.trim().charAt(0)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-ui text-white">{user.fullName}</span>
            <span className="block truncate text-small text-falak-300">{user.roleLabel}</span>
          </span>
        </div>
      ) : null}

      {footer ? <div className="mt-2">{footer}</div> : null}
    </nav>
  )
}
