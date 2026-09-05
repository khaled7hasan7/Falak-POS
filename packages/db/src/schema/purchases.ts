import { boolean, date, index, pgTable, smallint, text, uuid } from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import {
  auditTimestamps,
  createdAt,
  currencyCode,
  entityTimestamps,
  exchangeRate,
  inList,
  money,
  percent,
  pk,
  quantity,
  ts,
  unitCost,
} from './columns.js'
import { tenants, users, warehouses } from './core.js'
import { currencies } from './money.js'
import { productUnits, products } from './catalog.js'
import { stockBatches } from './inventory.js'
import { LEDGER_KINDS } from './customers.js'

/**
 * المشتريات والموردون.
 * المرجع: `docs/02-database.md §2` · `docs/01-project-and-permissions.md §6` (صلاحيات `purchases.*`).
 *
 * القاعدة 2 في CLAUDE.md: **لا كتابة مباشرة في `suppliers.balance`** —
 * التريجر `apply_supplier_transaction()` وحده يكتبه.
 */

export const PURCHASE_DOC_TYPES = ['order', 'invoice', 'return'] as const
export const PURCHASE_STATUSES = ['draft', 'ordered', 'received', 'cancelled'] as const

export const suppliers = pgTable('suppliers', {
  id: pk(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  address: text('address'),
  taxNumber: text('tax_number'),
  paymentTermsDays: smallint('payment_terms_days').notNull().default(0),
  /** cache: موجب = علينا له — يكتبه التريجر فقط */
  balance: money('balance').notNull().default('0'),
  notes: text('notes'),
  isActive: boolean('is_active').notNull().default(true),
  ...entityTimestamps,
})

export const purchases = pgTable(
  'purchases',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    docType: text('doc_type').notNull().default('invoice'),
    returnOfPurchaseId: uuid('return_of_purchase_id').references((): AnyPgColumn => purchases.id),
    /** رقم فاتورة المورد */
    referenceNo: text('reference_no'),
    status: text('status').notNull().default('draft'),
    currencyCode: currencyCode('currency_code')
      .notNull()
      .references(() => currencies.code),
    exchangeRate: exchangeRate('exchange_rate').notNull().default('1'),
    subtotal: money('subtotal').notNull().default('0'),
    discountTotal: money('discount_total').notNull().default('0'),
    taxTotal: money('tax_total').notNull().default('0'),
    total: money('total').notNull().default('0'),
    paidTotal: money('paid_total').notNull().default('0'),
    dueDate: date('due_date'),
    receivedAt: ts('received_at'),
    note: text('note'),
    userId: uuid('user_id').references(() => users.id),
    ...auditTimestamps,
  },
  (table) => [
    inList('purchases_doc_type_check', table.docType, PURCHASE_DOC_TYPES),
    inList('purchases_status_check', table.status, PURCHASE_STATUSES),
    index('purchases_supplier_idx').on(table.supplierId, table.createdAt.desc()),
  ]
)

export const purchaseLines = pgTable('purchase_lines', {
  id: pk(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  purchaseId: uuid('purchase_id')
    .notNull()
    .references(() => purchases.id),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  productUnitId: uuid('product_unit_id')
    .notNull()
    .references(() => productUnits.id),
  qty: quantity('qty').notNull(),
  unitCost: unitCost('unit_cost').notNull(),
  discountAmount: money('discount_amount').notNull().default('0'),
  taxRate: percent('tax_rate').notNull().default('0'),
  lineTotal: money('line_total').notNull(),
  batchNo: text('batch_no'),
  expiryDate: date('expiry_date'),
  /** يُملأ عند الاستلام */
  batchId: uuid('batch_id').references(() => stockBatches.id),
  /** كمية مجانية (بونص) شائعة عند الموردين */
  bonusQty: quantity('bonus_qty').notNull().default('0'),
  /** تحديث سعر البيع من فاتورة الشراء */
  sellPrice: money('sell_price'),
})

export const supplierTransactions = pgTable(
  'supplier_transactions',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    kind: text('kind').notNull(),
    /** موجب يزيد ما علينا، سالب يقلّله */
    amountBase: money('amount_base').notNull(),
    currencyCode: currencyCode('currency_code').references(() => currencies.code),
    amount: money('amount'),
    exchangeRate: exchangeRate('exchange_rate'),
    refType: text('ref_type'),
    refId: uuid('ref_id'),
    note: text('note'),
    userId: uuid('user_id').references(() => users.id),
    createdAt,
  },
  (table) => [
    inList('supplier_transactions_kind_check', table.kind, LEDGER_KINDS),
    index('supplier_transactions_idx').on(table.supplierId, table.createdAt.desc()),
  ]
)

export type Supplier = typeof suppliers.$inferSelect
export type Purchase = typeof purchases.$inferSelect
export type PurchaseLine = typeof purchaseLines.$inferSelect
