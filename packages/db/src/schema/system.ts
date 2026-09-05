import { sql } from 'drizzle-orm'
import { bigserial, boolean, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { createdAt, inList, pk, ts, updatedAt } from './columns.js'
import { branches, tenants, users } from './core.js'
import { customers } from './customers.js'

/**
 * النظام: تنبيهات، رسائل صادرة، صندوق مزامنة، وسجل الترحيلات.
 * المرجع: `docs/02-database.md §7` و`§8` · `docs/08-messaging-and-accounting.md`.
 */

export const NOTIFICATION_SEVERITIES = ['info', 'warning', 'danger'] as const

export const MESSAGE_CHANNELS = ['email', 'whatsapp'] as const
export const MESSAGE_STATUSES = [
  'queued',
  'sent',
  'delivered',
  'read',
  'failed',
  'cancelled',
] as const

export const SYNC_OPS = ['insert', 'update', 'delete'] as const

export const notifications = pgTable(
  'notifications',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** low_stock, expiry_soon, debt_overdue, shift_open, license_expiring */
    kind: text('kind').notNull(),
    severity: text('severity').notNull().default('info'),
    title: text('title').notNull(),
    body: text('body'),
    entity: text('entity'),
    entityId: uuid('entity_id'),
    isRead: boolean('is_read').notNull().default(false),
    createdAt,
  },
  (table) => [inList('notifications_severity_check', table.severity, NOTIFICATION_SEVERITIES)]
)

/** الرسائل الصادرة: تُنشأ محلياً وتُرسل عبر falak-cloud عند توفر الإنترنت */
export const outboundMessages = pgTable(
  'outbound_messages',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: uuid('branch_id').references(() => branches.id),
    channel: text('channel').notNull(),
    /** بريد أو رقم هاتف بصيغة دولية */
    recipient: text('recipient').notNull(),
    customerId: uuid('customer_id').references(() => customers.id),
    /** invoice, statement, debt_reminder, expiry_alert, daily_summary, broadcast */
    templateKey: text('template_key').notNull(),
    locale: text('locale').notNull().default('ar'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    attachmentRef: text('attachment_ref'),
    status: text('status').notNull().default('queued'),
    /** معرّف الرسالة عند المزوّد (Meta/Resend) */
    providerRef: text('provider_ref'),
    error: text('error'),
    refType: text('ref_type'),
    refId: uuid('ref_id'),
    createdBy: uuid('created_by').references(() => users.id),
    queuedAt: ts('queued_at').notNull().defaultNow(),
    sentAt: ts('sent_at'),
    updatedAt,
  },
  (table) => [
    inList('outbound_messages_channel_check', table.channel, MESSAGE_CHANNELS),
    inList('outbound_messages_status_check', table.status, MESSAGE_STATUSES),
    index('outbound_messages_pending_idx')
      .on(table.tenantId, table.queuedAt)
      .where(sql`${table.status} = 'queued'`),
    index('outbound_messages_customer_idx').on(table.customerId, table.queuedAt.desc()),
  ]
)

/** صندوق الصادر للمزامنة: كل تغيير محلي يُسجَّل هنا ثم يُرفع للسحابة */
export const syncOutbox = pgTable(
  'sync_outbox',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tableName: text('table_name').notNull(),
    rowId: text('row_id').notNull(),
    op: text('op').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt,
    syncedAt: ts('synced_at'),
  },
  (table) => [
    inList('sync_outbox_op_check', table.op, SYNC_OPS),
    index('sync_outbox_pending_idx')
      .on(table.id)
      .where(sql`${table.syncedAt} IS NULL`),
  ]
)

/** سجل الترحيلات المطبَّقة — يقرأه `src/scripts/migrate.ts` (`docs/02-database.md §8`) */
export const schemaMigrations = pgTable('schema_migrations', {
  version: text('version').primaryKey(),
  appliedAt: ts('applied_at').notNull().defaultNow(),
})

export type Notification = typeof notifications.$inferSelect
export type OutboundMessage = typeof outboundMessages.$inferSelect
export type SyncOutboxRow = typeof syncOutbox.$inferSelect
