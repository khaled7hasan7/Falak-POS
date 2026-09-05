import { Sidebar } from '@falak/ui'
import type { SidebarItem } from '@falak/ui'
import { FileSpreadsheet, LayoutGrid, Package, Ruler, Tags } from 'lucide-react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { usePrefs } from '../lib/prefs'
import { useSession } from '../lib/session'
import { Topbar } from './Topbar'

/**
 * الهيكل العام — `docs/03-design-system.md §5.1`:
 * `grid-template-columns: 220px 1fr`، القائمة الجانبية ليلية ثابتة (على اليمين
 * في RTL تلقائياً لأن التخطيط منطقي لا اتجاهي)، والمحتوى بحشوة 20 وفجوة 16.
 */

interface NavEntry extends SidebarItem {
  path: string
  /** الصلاحية التي تُظهر البند — الإخفاء فقط، والخادم يرفض 403 على أي حال */
  permission: string
}

const NAV: readonly Omit<NavEntry, 'label'>[] = [
  { key: 'products', path: '/products', icon: Package, permission: 'products.view' },
  { key: 'categories', path: '/categories', icon: Tags, permission: 'products.view' },
  { key: 'units', path: '/units', icon: Ruler, permission: 'products.view' },
  { key: 'import', path: '/import', icon: FileSpreadsheet, permission: 'products.import' },
  { key: 'dev-ui', path: '/dev/ui', icon: LayoutGrid, permission: 'products.view' },
]

/** عنوان الشاشة ومفتاح ترجمته حسب المسار */
const TITLE_KEYS: Record<string, string> = {
  products: 'product.title',
  categories: 'category.title',
  units: 'unit.title',
  import: 'import.title',
  'dev-ui': 'nav.settings',
}

export function AppLayout() {
  const { t } = usePrefs()
  const { user, can } = useSession()
  const navigate = useNavigate()
  const location = useLocation()

  const items = NAV.filter((entry) => can(entry.permission)).map((entry) => ({
    ...entry,
    label: entry.key === 'dev-ui' ? t('nav.settings') : t(`nav.${entry.key}`),
  }))

  const active =
    items.find((entry) => location.pathname.startsWith(entry.path))?.key ?? items[0]?.key
  const titleKey = active ? TITLE_KEYS[active] : undefined

  return (
    <div className="flex h-full">
      <Sidebar
        items={items}
        activeKey={active}
        onSelect={(key) => {
          const entry = items.find((item) => item.key === key)
          if (entry) navigate(entry.path)
        }}
        title={t('app.name')}
        user={
          user
            ? { fullName: user.fullName, roleLabel: t(`role.${user.role.name}`) }
            : undefined
        }
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={titleKey ? t(titleKey) : t('app.name')} />
        <main className="mx-auto flex w-full max-w-[1240px] flex-1 flex-col gap-4 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
