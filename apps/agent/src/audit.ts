import { auditLogs, syncOutbox } from '@falak/db'
import type { Database, Executor } from '@falak/db'

/**
 * `withAudit` — **القاعدة 4 في `CLAUDE.md`**:
 * كل عملية كتابة = معاملة واحدة تشمل التغيير + صف `audit_logs` + صف `sync_outbox`.
 *
 * المرجع: `docs/02-database.md §5.4` و`§7` و`§12`.
 *
 * لماذا مساعد واحد بدل كتابة الثلاثة يدوياً في كل مسار؟ لأن نسيان أحدها لا يُظهر
 * خطأً: الفاتورة تُحفظ والسجل ناقص، أو تُحفظ ولا تُرفع للسحابة أبداً. المساعد
 * يجعل نسيانها مستحيلاً بنيوياً — وهو يُبنى الآن لأن كل مراحل M2–M4 ستستعمله.
 *
 * `sync_outbox` يُكتب من **طبقة الـ API لا من تريجر** عمداً (`docs/02 §7.1`)،
 * حتى لا تتضاعف الصفوف عند استعادة نسخة احتياطية.
 */

/** الجداول التي تُزامَن مع السحابة — ما ليس هنا لا يُكتب له صف outbox */
export type SyncedTable = string

export interface AuditContext {
  tenantId: string
  userId: string
  deviceId?: string | null
}

export interface AuditEntry {
  /** `sale.completed`، `product.price_changed`… (`docs/01 §7`) */
  action: string
  /** اسم الجدول: `products`, `sales`… */
  entity: SyncedTable
  entityId: string
  /** الحالة قبل التغيير — إلزامية للتعديل والحذف حتى يمكن تتبّع ما تغيّر */
  before?: unknown
  after?: unknown
  /** عملية المزامنة. `null` يعني لا يُزامَن هذا الجدول */
  syncOp?: 'insert' | 'update' | 'delete' | null
  /** الحمولة المرفوعة — الافتراضي `after` */
  syncPayload?: unknown
}

/**
 * يكتب سجل العملية وصف المزامنة **داخل معاملة المستدعي**.
 * يجب أن يُستدعى بـ `tx` من `db.transaction(...)` لا بالاتصال العام،
 * وإلا انفصل السجل عن التغيير وضاع الضمان.
 */
export async function recordAudit(
  tx: Executor,
  context: AuditContext,
  entry: AuditEntry
): Promise<void> {
  await tx.insert(auditLogs).values({
    tenantId: context.tenantId,
    userId: context.userId,
    deviceId: context.deviceId ?? null,
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    before: entry.before === undefined ? null : (entry.before as Record<string, unknown>),
    after: entry.after === undefined ? null : (entry.after as Record<string, unknown>),
  })

  const op = entry.syncOp === undefined ? inferOp(entry) : entry.syncOp
  if (op === null) return

  await tx.insert(syncOutbox).values({
    tableName: entry.entity,
    rowId: entry.entityId,
    op,
    payload: (entry.syncPayload ?? entry.after ?? {}) as Record<string, unknown>,
  })
}

/** يستنتج نوع العملية من وجود before/after — إنشاء، تعديل، أو حذف */
function inferOp(entry: AuditEntry): 'insert' | 'update' | 'delete' {
  if (entry.before === undefined) return 'insert'
  if (entry.after === undefined) return 'delete'
  return 'update'
}

/**
 * يلفّ عملية كتابة كاملة: معاملة واحدة، ثم السجل والمزامنة قبل الإقفال.
 *
 * ```ts
 * const product = await withAudit(db, ctx, async (tx) => {
 *   const [row] = await tx.insert(products).values(input).returning()
 *   return { result: row, entry: { action: 'product.created', entity: 'products', entityId: row.id, after: row } }
 * })
 * ```
 */
export async function withAudit<T>(
  db: Database,
  context: AuditContext,
  work: (tx: Executor) => Promise<{ result: T; entry: AuditEntry | AuditEntry[] }>
): Promise<T> {
  return db.transaction(async (tx) => {
    const { result, entry } = await work(tx)
    for (const item of Array.isArray(entry) ? entry : [entry]) {
      await recordAudit(tx, context, item)
    }
    return result
  })
}
