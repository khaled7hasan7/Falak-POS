import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PERMISSIONS, ROLE_PERMISSIONS, SYSTEM_ROLES } from '../seed/permissions.js'
import type { PermissionValue } from '../seed/permissions.js'

/**
 * حارس التطابق بين مصفوفة `docs/01-project-and-permissions.md §6` وبين الكود.
 *
 * القاعدة 7 في `CLAUDE.md`: **الكود لا يعرف صلاحية لا تعرفها الوثيقة.** هذا
 * الاختبار يقرأ الجدول من الوثيقة نفسها ويقارنه بـ `permissions.ts`، فأي صلاحية
 * تُضاف في أحدهما دون الآخر تُسقط الاختبار.
 */

const DOC_PATH = resolve(
  fileURLToPath(new URL('../../../../docs/01-project-and-permissions.md', import.meta.url))
)

/** أعمدة المصفوفة بترتيبها في الوثيقة */
const ROLE_COLUMNS = ['owner', 'manager', 'cashier', 'stock_keeper', 'accountant'] as const

interface DocRow {
  /** الصلاحية كاملة كما في الوثيقة، بحدّها الرقمي إن وُجد (`pos.discount_line:10`) */
  permission: string
  granted: Set<string>
}

/**
 * يستخرج صفوف مصفوفة §6.
 *
 * الخلية الأولى تحمل صلاحية واحدة أو أكثر بين علامتَي `` ` ``، وقد تجمع الوثيقة
 * صلاحيتين متلازمتين في صف واحد (`products.create` / `products.edit`) — كلٌّ منهما
 * صفٌّ مستقل هنا بنفس توزيع الأدوار. الصفوف الشارحة والعناوين تُتجاهل.
 */
function parseMatrix(): DocRow[] {
  const doc = readFileSync(DOC_PATH, 'utf8')
  const section = doc.slice(doc.indexOf('## 6. مصفوفة الصلاحيات'), doc.indexOf('## 7.'))

  const rows: DocRow[] = []
  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) continue
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim())
    if (cells.length < 7) continue

    const names = [...cells[0]!.matchAll(/`([a-z_]+\.[a-z_*]+(?::\d+(?:\.\d+)?)?)`/g)].map(
      (m) => m[1]!
    )
    if (names.length === 0) continue

    const granted = new Set<string>()
    ROLE_COLUMNS.forEach((role, index) => {
      if (cells[2 + index]?.startsWith('✓')) granted.add(role)
    })
    for (const permission of names) rows.push({ permission, granted })
  }
  return rows
}

const docRows = parseMatrix()

/**
 * المقارنة بالنص الكامل **مع الحد الرقمي**، لأن `pos.discount_line:10` (خصم
 * محدود) و`pos.discount_line` (بلا حد) صلاحيتان مختلفتان في صفّين مختلفين.
 */
const codePermissions = new Set<string>(Object.values(PERMISSIONS))

describe('مصفوفة الصلاحيات — الوثيقة هي المصدر', () => {
  it('قرأ الجدول من الوثيقة فعلاً (لا صفر صفوف)', () => {
    expect(docRows.length).toBeGreaterThan(50)
  })

  it('كل صلاحية في الوثيقة معرّفة في الكود', () => {
    // `pharmacy.*` مجموعة في الوثيقة ومفصّلة في الكود إلى ثلاث صلاحيات
    const missing = docRows
      .map((r) => r.permission)
      .filter((name) => !name.endsWith('.*') && !codePermissions.has(name))
    expect(missing).toEqual([])
  })

  it('كل صلاحية في الكود موجودة في الوثيقة', () => {
    const documented = new Set(docRows.map((r) => r.permission))
    // صلاحيات الصيدلية الثلاث تقابل صف `pharmacy.*` الواحد في الوثيقة
    const pharmacyDetail = new Set([
      'pharmacy.prescriptions',
      'pharmacy.insurance',
      'pharmacy.claims',
    ])

    const undocumented = [...codePermissions].filter(
      (name) => !documented.has(name) && !pharmacyDetail.has(name)
    )
    expect(undocumented).toEqual([])
  })

  it('توزيع الأدوار في الكود يطابق ✓ في الوثيقة', () => {
    const mismatches: string[] = []

    for (const row of docRows) {
      if (row.permission.endsWith('.*')) continue

      for (const role of SYSTEM_ROLES) {
        const granted = ROLE_PERMISSIONS[role].some((p) => p === row.permission)
        const documented = row.granted.has(role)
        if (granted !== documented) {
          mismatches.push(
            `${row.permission} · ${role}: الكود=${granted ? '✓' : '–'} · الوثيقة=${documented ? '✓' : '–'}`
          )
        }
      }
    }

    expect(mismatches).toEqual([])
  })

  it('الحدود الرقمية في الوثيقة محفوظة في الكود', () => {
    const limited = docRows.filter((r) => r.permission.includes(':'))
    expect(limited.length, 'الوثيقة يجب أن تحمل صلاحيات بحدود رقمية').toBeGreaterThan(0)

    for (const row of limited) {
      const holders = SYSTEM_ROLES.filter((role) =>
        ROLE_PERMISSIONS[role].some((p) => p === row.permission)
      )
      expect(holders.length, `لا دور يحمل ${row.permission}`).toBeGreaterThan(0)
    }
  })
})

describe('الأزواج التراكمية (01 §6 — الصلاحيات تراكمية لا استثنائية)', () => {
  const pairs: [narrow: PermissionValue, broad: PermissionValue][] = [
    [PERMISSIONS.SUPPLIERS_VIEW, PERMISSIONS.SUPPLIERS_MANAGE],
    [PERMISSIONS.CUSTOMERS_CREATE, PERMISSIONS.CUSTOMERS_MANAGE],
    [PERMISSIONS.USERS_MANAGE, PERMISSIONS.USERS_MANAGE_OWNER],
    [PERMISSIONS.AUDIT_VIEW, PERMISSIONS.AUDIT_VIEW_ALL_BRANCHES],
  ]

  it.each(pairs)('من يملك الأوسع %s يملك الأضيق أيضاً', (narrow, broad) => {
    for (const role of SYSTEM_ROLES) {
      const permissions = ROLE_PERMISSIONS[role]
      if (permissions.includes(broad)) {
        expect(permissions, `${role} يملك ${broad} بلا ${narrow}`).toContain(narrow)
      }
    }
  })

  it('التوزيع المعتمد: أمين المخزن يعرض الموردين ولا يعدّلهم', () => {
    expect(ROLE_PERMISSIONS.stock_keeper).toContain(PERMISSIONS.SUPPLIERS_VIEW)
    expect(ROLE_PERMISSIONS.stock_keeper).not.toContain(PERMISSIONS.SUPPLIERS_MANAGE)
  })

  it('التوزيع المعتمد: الكاشير يضيف عميلاً ولا يعدّل القائم', () => {
    expect(ROLE_PERMISSIONS.cashier).toContain(PERMISSIONS.CUSTOMERS_CREATE)
    expect(ROLE_PERMISSIONS.cashier).not.toContain(PERMISSIONS.CUSTOMERS_MANAGE)
  })

  it('التوزيع المعتمد: المالك وحده يعدّل مستخدم المالك', () => {
    expect(ROLE_PERMISSIONS.owner).toContain(PERMISSIONS.USERS_MANAGE_OWNER)
    expect(ROLE_PERMISSIONS.manager).toContain(PERMISSIONS.USERS_MANAGE)
    expect(ROLE_PERMISSIONS.manager).not.toContain(PERMISSIONS.USERS_MANAGE_OWNER)
  })

  it('التوزيع المعتمد: المدير يرى سجل فرعه، والمالك والمحاسب كل الفروع', () => {
    expect(ROLE_PERMISSIONS.manager).toContain(PERMISSIONS.AUDIT_VIEW)
    expect(ROLE_PERMISSIONS.manager).not.toContain(PERMISSIONS.AUDIT_VIEW_ALL_BRANCHES)
    expect(ROLE_PERMISSIONS.owner).toContain(PERMISSIONS.AUDIT_VIEW_ALL_BRANCHES)
    expect(ROLE_PERMISSIONS.accountant).toContain(PERMISSIONS.AUDIT_VIEW_ALL_BRANCHES)
  })
})

describe('سلامة بنية الصلاحيات', () => {
  it('كل صلاحية بصيغة module.action أو module.action:limit', () => {
    for (const value of Object.values(PERMISSIONS)) {
      expect(value).toMatch(/^[a-z_]+\.[a-z_]+(:\d+(\.\d+)?)?$/)
    }
  })

  it('المالك يملك كل الصلاحيات بلا استثناء', () => {
    expect(new Set(ROLE_PERMISSIONS.owner)).toEqual(new Set(Object.values(PERMISSIONS)))
  })

  it('لا تكرار داخل أي دور', () => {
    for (const role of SYSTEM_ROLES) {
      const list = ROLE_PERMISSIONS[role]
      expect(new Set(list).size, `تكرار في ${role}`).toBe(list.length)
    }
  })

  it('الكاشير لا يملك أي صلاحية تكلفة أو ربح (docs/01 §5)', () => {
    for (const forbidden of [
      PERMISSIONS.PRODUCTS_VIEW_COST,
      PERMISSIONS.PRODUCTS_EDIT_PRICE,
      PERMISSIONS.REPORTS_PROFIT,
    ]) {
      expect(ROLE_PERMISSIONS.cashier).not.toContain(forbidden)
    }
  })
})
