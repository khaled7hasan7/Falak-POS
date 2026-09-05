import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import {
  auditTimestamps,
  createdAt,
  currencyCode,
  deletedAt,
  entityTimestamps,
  exchangeRate,
  inList,
  money,
  percent,
  pk,
  quantity,
  ts,
  unitCost,
  updatedAt,
} from './columns.js'
import { branches, devices, tenants, users, warehouses } from './core.js'
import { currencies, paymentMethods } from './money.js'
import { categories, priceLists, productUnits, products } from './catalog.js'
import { stockBatches } from './inventory.js'
import { customers } from './customers.js'
import { shifts } from './cash.js'

/**
 * المبيعات: فاتورة، أسطر، دفعات، عروض، وصفات وتأمين (صيدلية).
 * المرجع: `docs/02-database.md §3.1` و`§3.2` (المرتجع فاتورة) و`§5.4` (إتمام الفاتورة).
 */

export const SALE_DOC_TYPES = ['sale', 'return'] as const
export type SaleDocType = (typeof SALE_DOC_TYPES)[number]

export const SALE_STATUSES = ['draft', 'held', 'completed', 'voided'] as const
export type SaleStatus = (typeof SALE_STATUSES)[number]

export const PROMOTION_KINDS = [
  'percent',
  'fixed',
  'buy_x_get_y',
  'qty_price',
  'invoice_percent',
] as const
export const PROMOTION_SCOPES = ['product', 'category', 'invoice'] as const
export const CLAIM_STATUSES = ['pending', 'submitted', 'paid', 'rejected'] as const

export const promotions = pgTable(
  'promotions',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    scope: text('scope').notNull(),
    /** `{"percent":10}` أو `{"buy":2,"get":1}` */
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    startsAt: ts('starts_at'),
    endsAt: ts('ends_at'),
    isActive: boolean('is_active').notNull().default(true),
    ...entityTimestamps,
  },
  (table) => [
    inList('promotions_kind_check', table.kind, PROMOTION_KINDS),
    inList('promotions_scope_check', table.scope, PROMOTION_SCOPES),
  ]
)

export const promotionTargets = pgTable(
  'promotion_targets',
  {
    promotionId: uuid('promotion_id')
      .notNull()
      .references(() => promotions.id),
    productId: uuid('product_id').references(() => products.id),
    categoryId: uuid('category_id').references(() => categories.id),
  },
  (table) => [
    check(
      'promotion_targets_target_check',
      sql`${table.productId} IS NOT NULL OR ${table.categoryId} IS NOT NULL`
    ),
  ]
)

export const sales = pgTable(
  'sales',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    deviceId: uuid('device_id').references(() => devices.id),
    shiftId: uuid('shift_id').references(() => shifts.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    customerId: uuid('customer_id').references(() => customers.id),
    priceListId: uuid('price_list_id').references(() => priceLists.id),
    docType: text('doc_type').notNull().default('sale'),
    /** للمرتجع: الفاتورة الأصلية */
    returnOfSaleId: uuid('return_of_sale_id').references((): AnyPgColumn => sales.id),
    /** `BR1-2026-000123` — تسلسل لكل فرع (`docs/02-database.md §3.8`) */
    invoiceNo: text('invoice_no').notNull(),
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
    /** ما تبقى على الحساب */
    dueTotal: money('due_total').notNull().default('0'),
    /** لحساب الربح لحظياً */
    costTotal: money('cost_total').notNull().default('0'),
    note: text('note'),
    voidedBy: uuid('voided_by').references(() => users.id),
    voidReason: text('void_reason'),
    voidedAt: ts('voided_at'),
    completedAt: ts('completed_at'),
    ...auditTimestamps,
  },
  (table) => [
    inList('sales_doc_type_check', table.docType, SALE_DOC_TYPES),
    inList('sales_status_check', table.status, SALE_STATUSES),
    unique('sales_tenant_id_invoice_no_key').on(table.tenantId, table.invoiceNo),
    index('sales_day_idx').on(table.tenantId, table.branchId, table.completedAt.desc()),
    index('sales_customer_idx')
      .on(table.customerId)
      .where(sql`${table.customerId} IS NOT NULL`),
    index('sales_held_idx')
      .on(table.deviceId)
      .where(sql`${table.status} = 'held'`),
  ]
)

export const saleLines = pgTable(
  'sale_lines',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sales.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    productUnitId: uuid('product_unit_id')
      .notNull()
      .references(() => productUnits.id),
    batchId: uuid('batch_id').references(() => stockBatches.id),
    promotionId: uuid('promotion_id').references(() => promotions.id),
    /** بالوحدة المختارة (كيلو للموزون) */
    qty: quantity('qty').notNull(),
    unitPrice: money('unit_price').notNull(),
    discountAmount: money('discount_amount').notNull().default('0'),
    taxRate: percent('tax_rate').notNull().default('0'),
    taxAmount: money('tax_amount').notNull().default('0'),
    lineTotal: money('line_total').notNull(),
    /** التكلفة لحظة البيع */
    unitCost: unitCost('unit_cost').notNull().default('0'),
    isWeighed: boolean('is_weighed').notNull().default(false),
    /** كما قُرئ (يفيد لباركود الميزان — `docs/02-database.md §5.2`) */
    scannedBarcode: text('scanned_barcode'),
    sortOrder: smallint('sort_order').notNull().default(0),
    createdAt,
  },
  (table) => [
    index('sale_lines_sale_idx').on(table.saleId),
    index('sale_lines_product_idx').on(table.tenantId, table.productId),
  ]
)

export const salePayments = pgTable(
  'sale_payments',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sales.id),
    paymentMethodId: uuid('payment_method_id')
      .notNull()
      .references(() => paymentMethods.id),
    currencyCode: currencyCode('currency_code')
      .notNull()
      .references(() => currencies.code),
    /** بعملة الدفع */
    amount: money('amount').notNull(),
    exchangeRate: exchangeRate('exchange_rate').notNull().default('1'),
    /** بالعملة الأساسية */
    amountBase: money('amount_base').notNull(),
    changeGiven: money('change_given').notNull().default('0'),
    changeCurrency: currencyCode('change_currency').references(() => currencies.code),
    /** رقم عملية البطاقة */
    reference: text('reference'),
    createdAt,
  },
  (table) => [index('sale_payments_sale_idx').on(table.saleId)]
)

export const insuranceCompanies = pgTable('insurance_companies', {
  id: pk(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  name: text('name').notNull(),
  /** نسبة تتحملها الشركة */
  defaultSharePercent: percent('default_share_percent').notNull().default('0'),
  contact: text('contact'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt,
  /** أُضيف بالترحيل 0002 — ADR-003 */
  updatedAt,
  deletedAt,
})

export const prescriptions = pgTable(
  'prescriptions',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sales.id),
    insuranceCompanyId: uuid('insurance_company_id').references(() => insuranceCompanies.id),
    prescriptionNo: text('prescription_no'),
    doctorName: text('doctor_name'),
    patientName: text('patient_name'),
    patientIdNo: text('patient_id_no'),
    /** ما يُطالَب به من الشركة */
    insuranceShare: money('insurance_share').notNull().default('0'),
    patientShare: money('patient_share').notNull().default('0'),
    imageUrl: text('image_url'),
    claimStatus: text('claim_status').notNull().default('pending'),
    createdAt,
  },
  (table) => [inList('prescriptions_claim_status_check', table.claimStatus, CLAIM_STATUSES)]
)

export type Sale = typeof sales.$inferSelect
export type SaleLine = typeof saleLines.$inferSelect
export type SalePayment = typeof salePayments.$inferSelect
export type Promotion = typeof promotions.$inferSelect
