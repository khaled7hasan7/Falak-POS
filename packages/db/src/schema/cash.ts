import { sql } from 'drizzle-orm'
import { bigserial, boolean, date, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import {
  createdAt,
  currencyCode,
  deletedAt,
  entityTimestamps,
  inList,
  money,
  pk,
  ts,
  updatedAt,
} from './columns.js'
import { branches, devices, tenants, users } from './core.js'
import { currencies } from './money.js'

/**
 * الصندوق والورديات والمصروفات.
 * المرجع: `docs/02-database.md §3.5` (الورديات بعدة عملات) و`§5.6` (إغلاق الوردية).
 */

export const SHIFT_STATUSES = ['open', 'closed'] as const

export const CASH_MOVEMENT_KINDS = [
  'opening',
  'sale',
  'refund',
  'customer_payment',
  'supplier_payment',
  'expense',
  'deposit',
  'withdrawal',
  'closing',
] as const
export type CashMovementKind = (typeof CASH_MOVEMENT_KINDS)[number]

export const EXPENSE_SOURCES = ['register', 'bank', 'owner'] as const

/** عدّ الصندوق لكل عملة: `{"ILS": 500.00, "JOD": 20.000}` */
export type CashCount = Record<string, number>

export const cashRegisters = pgTable('cash_registers', {
  id: pk(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  branchId: uuid('branch_id')
    .notNull()
    .references(() => branches.id),
  deviceId: uuid('device_id').references(() => devices.id),
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  ...entityTimestamps,
})

export const shifts = pgTable(
  'shifts',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    cashRegisterId: uuid('cash_register_id')
      .notNull()
      .references(() => cashRegisters.id),
    openedBy: uuid('opened_by')
      .notNull()
      .references(() => users.id),
    closedBy: uuid('closed_by').references(() => users.id),
    status: text('status').notNull().default('open'),
    openedAt: ts('opened_at').notNull().defaultNow(),
    closedAt: ts('closed_at'),
    openingCash: jsonb('opening_cash').$type<CashCount>().notNull().default({}),
    /** محسوب من الحركات */
    expectedCash: jsonb('expected_cash').$type<CashCount>(),
    /** ما عدّه الكاشير */
    countedCash: jsonb('counted_cash').$type<CashCount>(),
    /** العجز/الزيادة لكل عملة */
    difference: jsonb('difference').$type<CashCount>(),
    note: text('note'),
    /** أُضيف بالترحيل 0002 — ADR-003 */
    updatedAt,
  },
  (table) => [
    inList('shifts_status_check', table.status, SHIFT_STATUSES),
    index('shifts_open_idx')
      .on(table.cashRegisterId)
      .where(sql`${table.status} = 'open'`),
  ]
)

/** كل ما يدخل الصندوق أو يخرج منه (موجب دخول، سالب خروج) */
export const cashMovements = pgTable(
  'cash_movements',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    cashRegisterId: uuid('cash_register_id')
      .notNull()
      .references(() => cashRegisters.id),
    shiftId: uuid('shift_id').references(() => shifts.id),
    kind: text('kind').notNull(),
    currencyCode: currencyCode('currency_code')
      .notNull()
      .references(() => currencies.code),
    amount: money('amount').notNull(),
    amountBase: money('amount_base').notNull(),
    refType: text('ref_type'),
    refId: uuid('ref_id'),
    userId: uuid('user_id').references(() => users.id),
    note: text('note'),
    createdAt,
  },
  (table) => [
    inList('cash_movements_kind_check', table.kind, CASH_MOVEMENT_KINDS),
    index('cash_movements_shift_idx').on(table.shiftId),
  ]
)

export const expenseCategories = pgTable('expense_categories', {
  id: pk(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  /** كهرباء، إيجار، رواتب، نثرية */
  name: text('name').notNull(),
  /** أُضيف بالترحيل 0002 — ADR-003 */
  updatedAt,
  deletedAt,
})

export const expenses = pgTable(
  'expenses',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    categoryId: uuid('category_id').references(() => expenseCategories.id),
    /** إن صُرف من الصندوق */
    shiftId: uuid('shift_id').references(() => shifts.id),
    currencyCode: currencyCode('currency_code')
      .notNull()
      .references(() => currencies.code),
    amount: money('amount').notNull(),
    amountBase: money('amount_base').notNull(),
    paidFrom: text('paid_from').notNull().default('register'),
    expenseDate: date('expense_date')
      .notNull()
      .default(sql`CURRENT_DATE`),
    description: text('description'),
    attachmentUrl: text('attachment_url'),
    userId: uuid('user_id').references(() => users.id),
    ...entityTimestamps,
  },
  (table) => [inList('expenses_paid_from_check', table.paidFrom, EXPENSE_SOURCES)]
)

export type CashRegister = typeof cashRegisters.$inferSelect
export type Shift = typeof shifts.$inferSelect
export type CashMovement = typeof cashMovements.$inferSelect
export type Expense = typeof expenses.$inferSelect
