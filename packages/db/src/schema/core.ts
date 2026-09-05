import { sql } from 'drizzle-orm'
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { createdAt, currencyCode, entityTimestamps, inList, pk, ts, updatedAt } from './columns.js'

/**
 * النواة: المستأجرون والفروع والمستخدمون والصلاحيات والسجل والتسلسلات.
 * المرجع: `docs/02-database.md §2` (خريطة المجموعات) · الـ DDL في `docs/falak_pos_schema.sql`.
 */

/** أنواع النشاط المدعومة (`docs/01-project-and-permissions.md §4`) */
export const BUSINESS_TYPES = ['supermarket', 'pharmacy', 'butcher', 'produce', 'general'] as const
export type BusinessType = (typeof BUSINESS_TYPES)[number]

/** مصدر تفعيل الوحدة: من الباقة أو يدوياً */
export const MODULE_SOURCES = ['plan', 'manual'] as const

export const tenants = pgTable(
  'tenants',
  {
    id: pk(),
    name: text('name').notNull(),
    businessType: text('business_type').notNull().default('supermarket'),
    baseCurrency: currencyCode('base_currency').notNull().default('ILS'),
    timezone: text('timezone').notNull().default('Asia/Hebron'),
    locale: text('locale').notNull().default('ar'),
    taxNumber: text('tax_number'),
    phone: text('phone'),
    address: text('address'),
    logoUrl: text('logo_url'),
    /** مفاتيح الإعدادات المعتمدة في `docs/02-database.md §12.5` */
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    ...entityTimestamps,
  },
  (table) => [inList('tenants_business_type_check', table.businessType, BUSINESS_TYPES)]
)

export const tenantModules = pgTable(
  'tenant_modules',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    moduleKey: text('module_key').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    source: text('source').notNull().default('manual'),
    updatedAt,
  },
  (table) => [
    primaryKey({ columns: [table.tenantId, table.moduleKey] }),
    inList('tenant_modules_source_check', table.source, MODULE_SOURCES),
  ]
)

export const branches = pgTable('branches', {
  id: pk(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  name: text('name').notNull(),
  phone: text('phone'),
  address: text('address'),
  isMain: boolean('is_main').notNull().default(false),
  ...entityTimestamps,
})

export const warehouses = pgTable('warehouses', {
  id: pk(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  branchId: uuid('branch_id')
    .notNull()
    .references(() => branches.id),
  name: text('name').notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  ...entityTimestamps,
})

export const roles = pgTable(
  'roles',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    /** صيغة `module.action` أو `module.action:limit` (`docs/01 §6`) */
    permissions: text('permissions')
      .array()
      .notNull()
      .default(sql`'{}'`),
    isSystem: boolean('is_system').notNull().default(false),
    ...entityTimestamps,
  },
  (table) => [unique('roles_tenant_id_name_key').on(table.tenantId, table.name)]
)

export const users = pgTable(
  'users',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    branchId: uuid('branch_id').references(() => branches.id),
    fullName: text('full_name').notNull(),
    username: text('username').notNull(),
    /** argon2 */
    passwordHash: text('password_hash'),
    /** argon2 لدخول سريع بـ PIN من 4–6 أرقام */
    pinHash: text('pin_hash'),
    phone: text('phone'),
    isActive: boolean('is_active').notNull().default(true),
    lastLoginAt: ts('last_login_at'),
    ...entityTimestamps,
  },
  (table) => [unique('users_tenant_id_username_key').on(table.tenantId, table.username)]
)

export const devices = pgTable(
  'devices',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: uuid('branch_id').references(() => branches.id),
    name: text('name').notNull(),
    /** بصمة الجهاز (CPU+disk+MAC hash) */
    fingerprint: text('fingerprint').notNull(),
    platform: text('platform'),
    appVersion: text('app_version'),
    lastSeenAt: ts('last_seen_at'),
    isActive: boolean('is_active').notNull().default(true),
    ...entityTimestamps,
  },
  (table) => [unique('devices_tenant_id_fingerprint_key').on(table.tenantId, table.fingerprint)]
)

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: uuid('user_id').references(() => users.id),
    deviceId: uuid('device_id').references(() => devices.id),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: uuid('entity_id'),
    before: jsonb('before').$type<Record<string, unknown>>(),
    after: jsonb('after').$type<Record<string, unknown>>(),
    createdAt,
  },
  (table) => [
    index('audit_logs_entity_idx').on(table.tenantId, table.entity, table.entityId),
    index('audit_logs_time_idx').on(table.tenantId, table.createdAt.desc()),
  ]
)

/** أرقام الفواتير المتسلسلة لكل فرع ونوع مستند (`docs/02-database.md §3.8`) */
export const sequences = pgTable(
  'sequences',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    seqKey: text('seq_key').notNull(),
    prefix: text('prefix').notNull(),
    nextValue: integer('next_value').notNull().default(1),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.branchId, table.seqKey] })]
)

/** مفاتيح التسلسل المستخدمة في `sequences.seq_key` (`docs/02-database.md §11`) */
export const SEQUENCE_KEYS = ['sale', 'return', 'purchase'] as const
export type SequenceKey = (typeof SEQUENCE_KEYS)[number]

export type Tenant = typeof tenants.$inferSelect
export type Branch = typeof branches.$inferSelect
export type Warehouse = typeof warehouses.$inferSelect
export type Role = typeof roles.$inferSelect
export type User = typeof users.$inferSelect
export type Device = typeof devices.$inferSelect
export type AuditLog = typeof auditLogs.$inferSelect
