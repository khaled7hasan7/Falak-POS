import { boolean, date, pgTable, smallint, text, unique, uuid } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import {
  createdAt,
  currencyCode,
  entityTimestamps,
  exchangeRate,
  inList,
  percent,
  pk,
} from './columns.js'
import { tenants, users } from './core.js'

/**
 * المال والإعدادات المالية: عملات، أسعار صرف، ضرائب، طرق دفع.
 * المرجع: `docs/02-database.md §2` و`§1` (المال بعملتين).
 */

/** أنواع طرق الدفع (`payment_methods.kind`) */
export const PAYMENT_METHOD_KINDS = ['cash', 'card', 'credit', 'wallet', 'bank', 'other'] as const
export type PaymentMethodKind = (typeof PAYMENT_METHOD_KINDS)[number]

export const currencies = pgTable('currencies', {
  code: currencyCode('code').primaryKey(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull(),
  symbol: text('symbol').notNull(),
  /** الشيكل 2، الدينار 3 — التقريب يحترمه (ADR-002 §4) */
  decimals: smallint('decimals').notNull().default(2),
})

export const exchangeRates = pgTable(
  'exchange_rates',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    currencyCode: currencyCode('currency_code')
      .notNull()
      .references(() => currencies.code),
    /** 1 وحدة من العملة = كم بالعملة الأساسية */
    rateToBase: exchangeRate('rate_to_base').notNull(),
    effectiveFrom: date('effective_from')
      .notNull()
      .default(sql`CURRENT_DATE`),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt,
  },
  (table) => [
    unique('exchange_rates_tenant_id_currency_code_effective_from_key').on(
      table.tenantId,
      table.currencyCode,
      table.effectiveFrom
    ),
  ]
)

export const taxes = pgTable('taxes', {
  id: pk(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  name: text('name').notNull(),
  /** 16.000 */
  rate: percent('rate').notNull().default('0'),
  /** السعر شامل الضريبة؟ */
  isInclusive: boolean('is_inclusive').notNull().default(true),
  isDefault: boolean('is_default').notNull().default(false),
  ...entityTimestamps,
})

export const paymentMethods = pgTable(
  'payment_methods',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    opensDrawer: boolean('opens_drawer').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: smallint('sort_order').notNull().default(0),
    ...entityTimestamps,
  },
  (table) => [inList('payment_methods_kind_check', table.kind, PAYMENT_METHOD_KINDS)]
)

export type Currency = typeof currencies.$inferSelect
export type ExchangeRate = typeof exchangeRates.$inferSelect
export type Tax = typeof taxes.$inferSelect
export type PaymentMethod = typeof paymentMethods.$inferSelect
