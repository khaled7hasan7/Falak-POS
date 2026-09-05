import { sql } from 'drizzle-orm'
import { char, check, numeric, timestamp, uuid } from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

/**
 * لبنات الأعمدة المشتركة — مصدر واحد لأنواع المال والكميات والطوابع الزمنية.
 * المرجع: `docs/02-database.md §1` (الأنواع الرقمية) وADR-002.
 *
 * القاعدة 3 في CLAUDE.md: المال `numeric` دائماً، **لا `float` أبداً**.
 * كل حقل مالي أو كمّي في المخطط يمرّ من هنا فلا تُكتب الدقّة يدوياً في أي جدول.
 */

/** مبلغ: `numeric(14,2)` */
export const money = (name: string) => numeric(name, { precision: 14, scale: 2 })

/** مبلغ اشتراك/باقة: `numeric(10,2)` (السحابة فقط) */
export const planMoney = (name: string) => numeric(name, { precision: 10, scale: 2 })

/** كمية: `numeric(14,3)` — الوزن يحتاج ثلاث منازل */
export const quantity = (name: string) => numeric(name, { precision: 14, scale: 3 })

/** تكلفة الوحدة: `numeric(14,4)` */
export const unitCost = (name: string) => numeric(name, { precision: 14, scale: 4 })

/** سعر صرف: `numeric(14,6)` */
export const exchangeRate = (name: string) => numeric(name, { precision: 14, scale: 6 })

/** نسبة مئوية: `numeric(6,3)` */
export const percent = (name: string) => numeric(name, { precision: 6, scale: 3 })

/** رمز عملة ISO-4217: `char(3)` */
export const currencyCode = (name: string) => char(name, { length: 3 })

/** طابع زمني بمنطقة: `timestamptz` (كل الطوابع في المخطط كذلك) */
export const ts = (name: string) => timestamp(name, { withTimezone: true })

/** مفتاح أساسي UUID يُولَّد على الجهاز — يمنع تعارض المزامنة (`docs/02-database.md §1`) */
export const pk = () => uuid('id').primaryKey().defaultRandom()

export const createdAt = ts('created_at').notNull().defaultNow()
export const updatedAt = ts('updated_at').notNull().defaultNow()
export const deletedAt = ts('deleted_at')

/** الطوابع الثلاثة لكيان قابل للحذف الناعم */
export const entityTimestamps = {
  createdAt,
  updatedAt,
  deletedAt,
}

/** طابعا الإنشاء والتعديل بلا حذف ناعم */
export const auditTimestamps = {
  createdAt,
  updatedAt,
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * قيد `CHECK (col IN (...))` — المخطط يستخدم `text + CHECK` بدل `ENUM`
 * (`docs/02-database.md §1`) ليُعدَّل بترحيل بسيط لا بـ `ALTER TYPE`.
 */
export function inList(name: string, column: AnyPgColumn, values: readonly string[]) {
  const list = values.map(quoteLiteral).join(', ')
  return check(name, sql.raw(`"${column.name}" IN (${list})`))
}
