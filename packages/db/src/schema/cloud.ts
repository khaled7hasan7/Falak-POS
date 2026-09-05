import { sql } from 'drizzle-orm'
import {
  bigint,
  bigserial,
  boolean,
  index,
  inet,
  integer,
  pgTable,
  smallint,
  text,
  uuid,
} from 'drizzle-orm/pg-core'
import {
  auditTimestamps,
  createdAt,
  currencyCode,
  inList,
  money,
  pk,
  planMoney,
  ts,
} from './columns.js'
import { devices, tenants } from './core.js'

/**
 * السحابة فقط: باقات، اشتراكات، تراخيص، إصدارات، نسخ احتياطي، الكتالوج المركزي.
 * المرجع: `docs/06-cloud-architecture.md` · `docs/05-marketing-and-pricing.md`.
 * هذه الجداول موجودة في نفس المخطط (مخطط واحد محلياً وسحابياً) لكنها لا تُستخدم محلياً.
 */

export const SUBSCRIPTION_STATUSES = [
  'trial',
  'active',
  'past_due',
  'suspended',
  'cancelled',
] as const
export const BILLING_CYCLES = ['monthly', 'yearly'] as const
export const RELEASE_CHANNELS = ['stable', 'beta'] as const
export const ROLLOUT_STATUSES = ['active', 'paused', 'rolled_back'] as const

export const plans = pgTable('plans', {
  id: pk(),
  /** basic, pharmacy, butcher, pro */
  code: text('code').notNull().unique(),
  nameAr: text('name_ar').notNull(),
  priceMonthly: planMoney('price_monthly').notNull(),
  priceYearly: planMoney('price_yearly').notNull(),
  currencyCode: currencyCode('currency_code').notNull().default('USD'),
  modules: text('modules')
    .array()
    .notNull()
    .default(sql`'{}'`),
  maxDevices: smallint('max_devices').notNull().default(1),
  maxBranches: smallint('max_branches').notNull().default(1),
  maxUsers: smallint('max_users').notNull().default(3),
  isActive: boolean('is_active').notNull().default(true),
})

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id),
    status: text('status').notNull().default('trial'),
    billingCycle: text('billing_cycle').notNull().default('monthly'),
    startsAt: ts('starts_at').notNull().defaultNow(),
    endsAt: ts('ends_at').notNull(),
    /** مهلة قبل الإيقاف */
    graceDays: smallint('grace_days').notNull().default(7),
    price: planMoney('price').notNull(),
    notes: text('notes'),
    ...auditTimestamps,
  },
  (table) => [
    inList('subscriptions_status_check', table.status, SUBSCRIPTION_STATUSES),
    inList('subscriptions_billing_cycle_check', table.billingCycle, BILLING_CYCLES),
    index('subscriptions_tenant_idx').on(table.tenantId, table.endsAt.desc()),
  ]
)

export const subscriptionPayments = pgTable('subscription_payments', {
  id: pk(),
  subscriptionId: uuid('subscription_id')
    .notNull()
    .references(() => subscriptions.id),
  amount: planMoney('amount').notNull(),
  currencyCode: currencyCode('currency_code').notNull(),
  /** cash, bank, palpay, jawwalpay */
  method: text('method'),
  reference: text('reference'),
  paidAt: ts('paid_at').notNull().defaultNow(),
  recordedBy: text('recorded_by'),
})

/** ترخيص موقّع لكل جهاز: JWT صالح 7 أيام يُجدَّد مع كل نبضة */
export const licenses = pgTable('licenses', {
  id: pk(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  deviceId: uuid('device_id')
    .notNull()
    .references(() => devices.id),
  /** FLK-XXXX-XXXX-XXXX يُدخل مرة واحدة */
  licenseKey: text('license_key').notNull().unique(),
  /** آخر JWT صادر — للمراجعة فقط، التحقق بالمفتاح العام */
  token: text('token'),
  issuedAt: ts('issued_at'),
  expiresAt: ts('expires_at'),
  revokedAt: ts('revoked_at'),
  revokeReason: text('revoke_reason'),
})

export const heartbeats = pgTable(
  'heartbeats',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id),
    appVersion: text('app_version'),
    dbVersion: text('db_version'),
    os: text('os'),
    ip: inet('ip'),
    lastSyncAt: ts('last_sync_at'),
    pendingRows: integer('pending_rows'),
    seenAt: ts('seen_at').notNull().defaultNow(),
  },
  (table) => [index('heartbeats_device_idx').on(table.deviceId, table.seenAt.desc())]
)

export const releases = pgTable(
  'releases',
  {
    id: pk(),
    /** 1.4.2 */
    version: text('version').notNull().unique(),
    channel: text('channel').notNull().default('stable'),
    notesAr: text('notes_ar'),
    packageUrl: text('package_url').notNull(),
    /** توقيع ed25519 للحزمة */
    signature: text('signature').notNull(),
    minDbVersion: text('min_db_version'),
    isMandatory: boolean('is_mandatory').notNull().default(false),
    publishedAt: ts('published_at'),
  },
  (table) => [inList('releases_channel_check', table.channel, RELEASE_CHANNELS)]
)

/** توزيع الإصدار: للجميع (`tenant_id` NULL) أو لمستأجر بعينه للتجربة */
export const rollouts = pgTable(
  'rollouts',
  {
    id: pk(),
    releaseId: uuid('release_id')
      .notNull()
      .references(() => releases.id),
    tenantId: uuid('tenant_id').references(() => tenants.id),
    status: text('status').notNull().default('active'),
    createdAt,
  },
  (table) => [inList('rollouts_status_check', table.status, ROLLOUT_STATUSES)]
)

export const backups = pgTable('backups', {
  id: pk(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  deviceId: uuid('device_id').references(() => devices.id),
  fileUrl: text('file_url').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }),
  checksum: text('checksum'),
  createdAt,
})

/** الكتالوج المركزي المشترك بين كل العملاء */
export const centralProducts = pgTable(
  'central_products',
  {
    id: pk(),
    barcode: text('barcode').notNull().unique(),
    nameAr: text('name_ar').notNull(),
    nameEn: text('name_en'),
    category: text('category'),
    /** pharmacy / supermarket … */
    businessType: text('business_type'),
    manufacturer: text('manufacturer'),
    activeIngredient: text('active_ingredient'),
    imageUrl: text('image_url'),
    suggestedPrice: money('suggested_price'),
    contributedBy: uuid('contributed_by').references(() => tenants.id),
    verified: boolean('verified').notNull().default(false),
    ...auditTimestamps,
  },
  (table) => [index('central_products_name_idx').using('gin', sql`${table.nameAr} gin_trgm_ops`)]
)

export type Plan = typeof plans.$inferSelect
export type Subscription = typeof subscriptions.$inferSelect
export type License = typeof licenses.$inferSelect
export type Release = typeof releases.$inferSelect
export type CentralProduct = typeof centralProducts.$inferSelect
