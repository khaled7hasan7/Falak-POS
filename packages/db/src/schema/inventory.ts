import { sql } from 'drizzle-orm'
import { bigserial, date, index, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core'
import {
  auditTimestamps,
  createdAt,
  inList,
  money,
  pk,
  quantity,
  ts,
  unitCost,
  updatedAt,
} from './columns.js'
import { devices, tenants, users, warehouses } from './core.js'
import { breakdownTemplates, categories, products } from './catalog.js'

/**
 * المخزون: دفعات، حركات (مصدر الحقيقة)، أرصدة (cache)، تحويل، جرد، تقطيع.
 * المرجع: `docs/02-database.md §3.3` و`§3.4` و`§4` و`§5.3`.
 *
 * القاعدة 2 في CLAUDE.md: **لا كتابة مباشرة في `stock_levels`** — التريجر
 * `apply_stock_movement()` وحده يكتبها من `stock_movements`.
 */

export const MOVEMENT_TYPES = [
  'sale',
  'sale_return',
  'purchase',
  'purchase_return',
  'adjustment',
  'transfer_in',
  'transfer_out',
  'breakdown_in',
  'breakdown_out',
  'stocktake',
  'opening',
] as const
export type MovementType = (typeof MOVEMENT_TYPES)[number]

export const TRANSFER_STATUSES = ['draft', 'sent', 'received', 'cancelled'] as const
export const STOCKTAKE_STATUSES = ['open', 'counting', 'approved', 'cancelled'] as const

export const stockBatches = pgTable(
  'stock_batches',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    batchNo: text('batch_no'),
    expiryDate: date('expiry_date'),
    /** بالعملة الأساسية، للوحدة الأساسية */
    unitCost: unitCost('unit_cost').notNull().default('0'),
    qtyOnHand: quantity('qty_on_hand').notNull().default('0'),
    receivedAt: ts('received_at').notNull().defaultNow(),
    /** purchase / adjustment / breakdown / opening */
    sourceType: text('source_type'),
    sourceId: uuid('source_id'),
    ...auditTimestamps,
  },
  (table) => [
    index('stock_batches_fefo_idx')
      .on(table.tenantId, table.productId, table.warehouseId, table.expiryDate)
      .where(sql`${table.qtyOnHand} > 0`),
  ]
)

/** مصدر الحقيقة لكل حركة مخزون (كمية موجبة = دخول، سالبة = خروج) */
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    batchId: uuid('batch_id').references(() => stockBatches.id),
    movementType: text('movement_type').notNull(),
    /** بالوحدة الأساسية دائماً (`qty_base = qty × factor`) */
    qty: quantity('qty').notNull(),
    unitCost: unitCost('unit_cost').notNull().default('0'),
    refType: text('ref_type'),
    refId: uuid('ref_id'),
    userId: uuid('user_id').references(() => users.id),
    deviceId: uuid('device_id').references(() => devices.id),
    note: text('note'),
    createdAt,
  },
  (table) => [
    inList('stock_movements_movement_type_check', table.movementType, MOVEMENT_TYPES),
    index('stock_movements_product_idx').on(
      table.tenantId,
      table.productId,
      table.createdAt.desc()
    ),
    index('stock_movements_ref_idx').on(table.refType, table.refId),
  ]
)

/** رصيد مُخزَّن (cache) يُحدَّثه التريجر من الحركات — لا يُكتب مباشرة أبداً */
export const stockLevels = pgTable(
  'stock_levels',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    qtyOnHand: quantity('qty_on_hand').notNull().default('0'),
    avgCost: unitCost('avg_cost').notNull().default('0'),
    updatedAt,
  },
  (table) => [primaryKey({ columns: [table.productId, table.warehouseId] })]
)

export const stockTransfers = pgTable(
  'stock_transfers',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    fromWarehouseId: uuid('from_warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    toWarehouseId: uuid('to_warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    status: text('status').notNull().default('draft'),
    note: text('note'),
    createdBy: uuid('created_by').references(() => users.id),
    ...auditTimestamps,
  },
  (table) => [inList('stock_transfers_status_check', table.status, TRANSFER_STATUSES)]
)

export const stockTransferLines = pgTable('stock_transfer_lines', {
  id: pk(),
  transferId: uuid('transfer_id')
    .notNull()
    .references(() => stockTransfers.id),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  batchId: uuid('batch_id').references(() => stockBatches.id),
  qty: quantity('qty').notNull(),
})

export const stocktakes = pgTable(
  'stocktakes',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    /** جرد جزئي */
    categoryId: uuid('category_id').references(() => categories.id),
    status: text('status').notNull().default('open'),
    startedBy: uuid('started_by').references(() => users.id),
    approvedBy: uuid('approved_by').references(() => users.id),
    startedAt: ts('started_at').notNull().defaultNow(),
    approvedAt: ts('approved_at'),
    note: text('note'),
    /** أُضيف بالترحيل 0002 — ADR-003 */
    updatedAt,
  },
  (table) => [inList('stocktakes_status_check', table.status, STOCKTAKE_STATUSES)]
)

export const stocktakeLines = pgTable('stocktake_lines', {
  id: pk(),
  stocktakeId: uuid('stocktake_id')
    .notNull()
    .references(() => stocktakes.id),
  productId: uuid('product_id')
    .notNull()
    .references(() => products.id),
  batchId: uuid('batch_id').references(() => stockBatches.id),
  expectedQty: quantity('expected_qty').notNull(),
  countedQty: quantity('counted_qty'),
  /** damaged / theft / entry_error / expired */
  reason: text('reason'),
  countedBy: uuid('counted_by').references(() => users.id),
  countedAt: ts('counted_at'),
})

/** تنفيذ تقطيع فعلي (ملحمة) */
export const breakdownRuns = pgTable('breakdown_runs', {
  id: pk(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  templateId: uuid('template_id').references(() => breakdownTemplates.id),
  parentProductId: uuid('parent_product_id')
    .notNull()
    .references(() => products.id),
  warehouseId: uuid('warehouse_id')
    .notNull()
    .references(() => warehouses.id),
  /** 40.000 كغ */
  inputQty: quantity('input_qty').notNull(),
  /** التكلفة الإجمالية للمدخل */
  inputCost: money('input_cost').notNull(),
  wasteQty: quantity('waste_qty').notNull().default('0'),
  userId: uuid('user_id').references(() => users.id),
  createdAt,
  /** أُضيف بالترحيل 0002 — ADR-003 */
  updatedAt,
})

export const breakdownRunLines = pgTable('breakdown_run_lines', {
  id: pk(),
  runId: uuid('run_id')
    .notNull()
    .references(() => breakdownRuns.id),
  outputProductId: uuid('output_product_id')
    .notNull()
    .references(() => products.id),
  qty: quantity('qty').notNull(),
  /** نصيب هذه القطعة من التكلفة */
  allocatedCost: money('allocated_cost').notNull(),
})

export type StockBatch = typeof stockBatches.$inferSelect
export type StockMovement = typeof stockMovements.$inferSelect
export type StockLevel = typeof stockLevels.$inferSelect
export type Stocktake = typeof stocktakes.$inferSelect
