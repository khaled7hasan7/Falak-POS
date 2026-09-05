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
  inList,
  money,
  percent,
  pk,
  quantity,
  updatedAt,
} from './columns.js'
import { branches, devices, tenants, users } from './core.js'
import { currencies, taxes } from './money.js'

/**
 * الكتالوج: تصنيفات، وحدات، أصناف، وحدات بيع، باركود، قوائم أسعار،
 * امتداد الصيدلية، قوالب التقطيع، وأزرار الكاشير السريعة.
 * المرجع: `docs/02-database.md §2` و`§3.1` و`§5.1`.
 */

export const PRODUCT_TYPES = ['standard', 'weighed', 'service', 'composite'] as const
export type ProductType = (typeof PRODUCT_TYPES)[number]

export const COST_METHODS = ['avg', 'fifo', 'last'] as const
export type CostMethod = (typeof COST_METHODS)[number]

export const QUICK_BUTTON_TARGETS = ['product', 'category', 'page'] as const

export const categories = pgTable('categories', {
  id: pk(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  parentId: uuid('parent_id').references((): AnyPgColumn => categories.id),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en'),
  color: text('color'),
  sortOrder: smallint('sort_order').notNull().default(0),
  ...entityTimestamps,
})

export const units = pgTable('units', {
  id: pk(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  /** حبة، كرتونة، كيلو، علبة، شريط */
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en'),
  symbol: text('symbol'),
  /** الكيلو نعم، الحبة لا */
  allowFraction: boolean('allow_fraction').notNull().default(false),
  ...entityTimestamps,
})

export const products = pgTable(
  'products',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    categoryId: uuid('category_id').references(() => categories.id),
    baseUnitId: uuid('base_unit_id')
      .notNull()
      .references(() => units.id),
    taxId: uuid('tax_id').references(() => taxes.id),
    sku: text('sku'),
    nameAr: text('name_ar').notNull(),
    nameEn: text('name_en'),
    productType: text('product_type').notNull().default('standard'),
    trackExpiry: boolean('track_expiry').notNull().default(false),
    trackBatches: boolean('track_batches').notNull().default(false),
    /** يُباع بالوزن (ملحمة/خضار) */
    isWeighed: boolean('is_weighed').notNull().default(false),
    /** كود الميزان (4-5 أرقام) — `docs/02-database.md §5.2` */
    pluCode: text('plu_code'),
    costMethod: text('cost_method').notNull().default('avg'),
    minStock: quantity('min_stock').notNull().default('0'),
    reorderQty: quantity('reorder_qty').notNull().default('0'),
    manufacturer: text('manufacturer'),
    imageUrl: text('image_url'),
    /** (مهمل) استُبدل بجدول `pos_quick_buttons` */
    quickKeyPos: smallint('quick_key_pos'),
    attributes: jsonb('attributes').$type<Record<string, unknown>>().notNull().default({}),
    isActive: boolean('is_active').notNull().default(true),
    ...entityTimestamps,
  },
  (table) => [
    inList('products_product_type_check', table.productType, PRODUCT_TYPES),
    inList('products_cost_method_check', table.costMethod, COST_METHODS),
    index('products_name_trgm_idx').using('gin', sql`${table.nameAr} gin_trgm_ops`),
    index('products_tenant_active_idx')
      .on(table.tenantId)
      .where(sql`${table.deletedAt} IS NULL`),
  ]
)

/** وحدات البيع للصنف: حبة (factor 1)، كرتونة (factor 24)، شريط (factor 10)… */
export const productUnits = pgTable(
  'product_units',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    /** كم وحدة أساسية داخلها */
    factor: quantity('factor').notNull().default('1'),
    isDefault: boolean('is_default').notNull().default(false),
    ...entityTimestamps,
  },
  (table) => [unique('product_units_product_id_unit_id_key').on(table.productId, table.unitId)]
)

export const productBarcodes = pgTable(
  'product_barcodes',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    productUnitId: uuid('product_unit_id').references(() => productUnits.id),
    barcode: text('barcode').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt,
    /** أُضيف بالترحيل 0002 — ADR-003 */
    updatedAt,
    deletedAt,
  },
  (table) => [
    unique('product_barcodes_tenant_id_barcode_key').on(table.tenantId, table.barcode),
    index('product_barcodes_lookup_idx')
      .on(table.barcode)
      .where(sql`${table.deletedAt} IS NULL`),
  ]
)

export const priceLists = pgTable('price_lists', {
  id: pk(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  /** تجزئة، جملة، VIP */
  name: text('name').notNull(),
  currencyCode: currencyCode('currency_code')
    .notNull()
    .references(() => currencies.code),
  isDefault: boolean('is_default').notNull().default(false),
  ...entityTimestamps,
})

export const productPrices = pgTable(
  'product_prices',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    productUnitId: uuid('product_unit_id')
      .notNull()
      .references(() => productUnits.id),
    priceListId: uuid('price_list_id')
      .notNull()
      .references(() => priceLists.id),
    price: money('price').notNull(),
    /** لا يُسمح بخصم أقل منه بدون صلاحية `pos.below_min_price` */
    minPrice: money('min_price'),
    updatedBy: uuid('updated_by').references(() => users.id),
    ...auditTimestamps,
  },
  (table) => [
    unique('product_prices_product_unit_id_price_list_id_key').on(
      table.productUnitId,
      table.priceListId
    ),
  ]
)

/** امتداد الصيدلية — صف واحد لكل صنف دوائي */
export const pharmaProducts = pgTable(
  'pharma_products',
  {
    productId: uuid('product_id')
      .primaryKey()
      .references(() => products.id),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    activeIngredient: text('active_ingredient'),
    strength: text('strength'),
    dosageForm: text('dosage_form'),
    requiresPrescription: boolean('requires_prescription').notNull().default(false),
    isControlled: boolean('is_controlled').notNull().default(false),
    storageCondition: text('storage_condition'),
    updatedAt,
  },
  (table) => [index('pharma_active_ingredient_idx').on(table.tenantId, table.activeIngredient)]
)

/** قوالب التقطيع (ملحمة): خروف كامل ← فروم/كستليتة/عظم */
export const breakdownTemplates = pgTable('breakdown_templates', {
  id: pk(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  parentProductId: uuid('parent_product_id')
    .notNull()
    .references(() => products.id),
  name: text('name').notNull(),
  ...entityTimestamps,
})

export const breakdownTemplateLines = pgTable('breakdown_template_lines', {
  id: pk(),
  templateId: uuid('template_id')
    .notNull()
    .references(() => breakdownTemplates.id),
  outputProductId: uuid('output_product_id')
    .notNull()
    .references(() => products.id),
  /** نسبة الوزن الناتج */
  yieldPercent: percent('yield_percent').notNull(),
  /** نسبة التكلفة الموزعة (تختلف عن الوزن: الفيليه أغلى) */
  costSharePercent: percent('cost_share_percent').notNull(),
})

/** أزرار الكاشير السريعة: شبكة قابلة للتخصيص لكل فرع (وجهاز اختيارياً) */
export const posQuickButtons = pgTable(
  'pos_quick_buttons',
  {
    id: pk(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** NULL = كل الفروع */
    branchId: uuid('branch_id').references(() => branches.id),
    /** NULL = كل الأجهزة (تخصيص لجهاز يغلب العام) */
    deviceId: uuid('device_id').references(() => devices.id),
    targetType: text('target_type').notNull(),
    productId: uuid('product_id').references(() => products.id),
    categoryId: uuid('category_id').references(() => categories.id),
    pageNo: smallint('page_no').notNull().default(1),
    position: smallint('position').notNull(),
    label: text('label'),
    /** اسم token لا hex (`docs/03-design-system.md`) */
    color: text('color'),
    imageUrl: text('image_url'),
    isActive: boolean('is_active').notNull().default(true),
    ...entityTimestamps,
  },
  (table) => [
    inList('pos_quick_buttons_target_type_check', table.targetType, QUICK_BUTTON_TARGETS),
    check(
      'pos_quick_buttons_target_ref_check',
      sql`(${table.targetType} = 'product'  AND ${table.productId} IS NOT NULL) OR
          (${table.targetType} = 'category' AND ${table.categoryId} IS NOT NULL) OR
          (${table.targetType} = 'page')`
    ),
    index('pos_quick_buttons_grid_idx')
      .on(table.tenantId, table.branchId, table.deviceId, table.pageNo, table.position)
      .where(sql`${table.deletedAt} IS NULL`),
  ]
)

export type Category = typeof categories.$inferSelect
export type Unit = typeof units.$inferSelect
export type Product = typeof products.$inferSelect
export type ProductUnit = typeof productUnits.$inferSelect
export type ProductBarcode = typeof productBarcodes.$inferSelect
export type PriceList = typeof priceLists.$inferSelect
export type ProductPrice = typeof productPrices.$inferSelect
