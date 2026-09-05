import { sql } from 'drizzle-orm'
import { boolean, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import {
  createdAt,
  currencyCode,
  entityTimestamps,
  exchangeRate,
  inList,
  money,
  pk,
} from './columns.js'
import { tenants, users } from './core.js'
import { currencies } from './money.js'
import { priceLists } from './catalog.js'

/**
 * العملاء والذمم والولاء.
 * المرجع: `docs/02-database.md §3.6` (موجب = عليه لنا) و`§5.7` (كشف الحساب).
 *
 * القاعدة 2 في CLAUDE.md: **لا كتابة مباشرة في `customers.balance`** —
 * التريجر `apply_customer_transaction()` وحده يكتبه من `customer_transactions`.
 */

export const LEDGER_KINDS = ['opening', 'invoice', 'payment', 'return', 'adjustment'] as const
export type LedgerKind = (typeof LEDGER_KINDS)[number]

export const customers = pgTable(
  'customers',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    priceListId: uuid('price_list_id').references(() => priceLists.id),
    name: text('name').notNull(),
    phone: text('phone'),
    email: text('email'),
    address: text('address'),
    taxNumber: text('tax_number'),
    /** 0 = لا يُسمح بالدين */
    creditLimit: money('credit_limit').notNull().default('0'),
    /** cache: موجب = عليه لنا — يكتبه التريجر فقط */
    balance: money('balance').notNull().default('0'),
    loyaltyPoints: integer('loyalty_points').notNull().default(0),
    notes: text('notes'),
    isActive: boolean('is_active').notNull().default(true),
    ...entityTimestamps,
  },
  (table) => [
    index('customers_phone_idx').on(table.tenantId, table.phone),
    index('customers_name_trgm_idx').using('gin', sql`${table.name} gin_trgm_ops`),
  ]
)

/** دفتر الدين: كل سطر يغيّر رصيد العميل (موجب يزيد ما عليه، سالب يقلّله) */
export const customerTransactions = pgTable(
  'customer_transactions',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    kind: text('kind').notNull(),
    /** بالعملة الأساسية */
    amountBase: money('amount_base').notNull(),
    currencyCode: currencyCode('currency_code').references(() => currencies.code),
    /** بالعملة الأصلية للدفعة */
    amount: money('amount'),
    exchangeRate: exchangeRate('exchange_rate'),
    refType: text('ref_type'),
    refId: uuid('ref_id'),
    note: text('note'),
    userId: uuid('user_id').references(() => users.id),
    createdAt,
  },
  (table) => [
    inList('customer_transactions_kind_check', table.kind, LEDGER_KINDS),
    index('customer_transactions_idx').on(table.customerId, table.createdAt.desc()),
  ]
)

export const loyaltyTransactions = pgTable('loyalty_transactions', {
  id: pk(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id),
  /** موجب كسب، سالب استبدال */
  points: integer('points').notNull(),
  refType: text('ref_type'),
  refId: uuid('ref_id'),
  createdAt,
})

export type Customer = typeof customers.$inferSelect
export type CustomerTransaction = typeof customerTransactions.$inferSelect
