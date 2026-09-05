import { z } from 'zod'
import { barcode, currencyCode, money, quantity, uuid } from './primitives.js'

/** الكتالوج: تصنيفات، وحدات، أصناف، باركودات، أسعار. المرجع: docs/02-database.md §2 و§13. */

// ── التصنيفات ────────────────────────────────────────────────────────────────
export const category = z.object({
  id: uuid,
  parentId: uuid.nullable(),
  nameAr: z.string(),
  nameEn: z.string().nullable(),
  color: z.string().nullable(),
  sortOrder: z.number().int(),
})
export type Category = z.infer<typeof category>

export const categoryInput = z.object({
  parentId: uuid.nullable().optional(),
  nameAr: z.string().min(1, 'اسم التصنيف مطلوب').max(120),
  nameEn: z.string().max(120).nullable().optional(),
  color: z.string().max(40).nullable().optional(),
  sortOrder: z.number().int().min(0).max(32767).optional(),
})
export type CategoryInput = z.infer<typeof categoryInput>

// ── وحدات القياس ─────────────────────────────────────────────────────────────
export const unit = z.object({
  id: uuid,
  nameAr: z.string(),
  nameEn: z.string().nullable(),
  symbol: z.string().nullable(),
  allowFraction: z.boolean(),
})
export type Unit = z.infer<typeof unit>

export const unitInput = z.object({
  nameAr: z.string().min(1, 'اسم الوحدة مطلوب').max(60),
  nameEn: z.string().max(60).nullable().optional(),
  symbol: z.string().max(16).nullable().optional(),
  /** الكيلو يقبل الكسور، الحبة لا (docs/02 §13 · units) */
  allowFraction: z.boolean().default(false),
})
export type UnitInput = z.infer<typeof unitInput>

// ── قوائم الأسعار ────────────────────────────────────────────────────────────
export const priceList = z.object({
  id: uuid,
  name: z.string(),
  currencyCode,
  isDefault: z.boolean(),
})
export type PriceList = z.infer<typeof priceList>

// ── الصنف ────────────────────────────────────────────────────────────────────
export const productTypes = ['standard', 'weighed', 'service', 'composite'] as const
export const productType = z.enum(productTypes)

export const costMethods = ['avg', 'fifo', 'last'] as const
export const costMethod = z.enum(costMethods)

/** سعر وحدة داخل قائمة أسعار. `minPrice` هو الحد الذي لا يُباع تحته بلا صلاحية `pos.below_min_price`. */
export const productPriceInput = z.object({
  priceListId: uuid,
  price: money,
  minPrice: money.nullable().optional(),
})
export type ProductPriceInput = z.infer<typeof productPriceInput>

/**
 * وحدة بيع للصنف: حبة (factor 1)، كرتونة (factor 24)، شريط (factor 10)…
 * `factor` = كم وحدة أساسية داخلها، ومنه `qty_base = qty × factor` (القاعدة 3).
 */
export const productUnitInput = z.object({
  id: uuid.optional(),
  unitId: uuid,
  factor: quantity.refine((v) => Number(v) > 0, 'المعامل أكبر من صفر'),
  isDefault: z.boolean().default(false),
  prices: z.array(productPriceInput).default([]),
})
export type ProductUnitInput = z.infer<typeof productUnitInput>

export const productBarcodeInput = z.object({
  id: uuid.optional(),
  barcode,
  /** الباركود قد يخص وحدة بعينها (باركود الكرتونة يختلف عن باركود الحبة) */
  productUnitId: uuid.nullable().optional(),
  isPrimary: z.boolean().default(false),
})
export type ProductBarcodeInput = z.infer<typeof productBarcodeInput>

export const productInput = z
  .object({
    categoryId: uuid.nullable().optional(),
    baseUnitId: uuid,
    taxId: uuid.nullable().optional(),
    sku: z.string().max(64).nullable().optional(),
    nameAr: z.string().min(1, 'اسم الصنف مطلوب').max(200),
    nameEn: z.string().max(200).nullable().optional(),
    productType: productType.default('standard'),
    trackExpiry: z.boolean().default(false),
    trackBatches: z.boolean().default(false),
    isWeighed: z.boolean().default(false),
    pluCode: z
      .string()
      .regex(/^\d{3,6}$/, 'كود الميزان من 3 إلى 6 أرقام')
      .nullable()
      .optional(),
    costMethod: costMethod.default('avg'),
    minStock: quantity.default('0'),
    reorderQty: quantity.default('0'),
    manufacturer: z.string().max(160).nullable().optional(),
    imageUrl: z.string().max(500).nullable().optional(),
    isActive: z.boolean().default(true),
    units: z.array(productUnitInput).min(1, 'الصنف يحتاج وحدة بيع واحدة على الأقل'),
    barcodes: z.array(productBarcodeInput).default([]),
  })
  .refine((p) => p.units.filter((u) => u.isDefault).length === 1, {
    message: 'حدّد وحدة افتراضية واحدة بالضبط',
    path: ['units'],
  })
  .refine((p) => !p.isWeighed || p.pluCode != null, {
    message: 'الصنف الموزون يحتاج كود ميزان (PLU)',
    path: ['pluCode'],
  })
export type ProductInput = z.infer<typeof productInput>

/** الصنف كما يُعاد من الوكيل، بوحداته وباركوداته وأسعاره. */
export const product = z.object({
  id: uuid,
  categoryId: uuid.nullable(),
  categoryNameAr: z.string().nullable(),
  baseUnitId: uuid,
  taxId: uuid.nullable(),
  sku: z.string().nullable(),
  nameAr: z.string(),
  nameEn: z.string().nullable(),
  productType,
  trackExpiry: z.boolean(),
  trackBatches: z.boolean(),
  isWeighed: z.boolean(),
  pluCode: z.string().nullable(),
  costMethod,
  minStock: quantity,
  reorderQty: quantity,
  manufacturer: z.string().nullable(),
  imageUrl: z.string().nullable(),
  isActive: z.boolean(),
  units: z.array(
    z.object({
      id: uuid,
      unitId: uuid,
      unitNameAr: z.string(),
      factor: quantity,
      isDefault: z.boolean(),
      prices: z.array(
        z.object({
          priceListId: uuid,
          priceListName: z.string(),
          price: money,
          minPrice: money.nullable(),
        })
      ),
    })
  ),
  barcodes: z.array(
    z.object({
      id: uuid,
      barcode,
      productUnitId: uuid.nullable(),
      isPrimary: z.boolean(),
    })
  ),
})
export type Product = z.infer<typeof product>

/** صف مختصر لقائمة الأصناف — لا نُحمّل الوحدات والأسعار كلها في الجدول. */
export const productListItem = z.object({
  id: uuid,
  nameAr: z.string(),
  nameEn: z.string().nullable(),
  sku: z.string().nullable(),
  categoryNameAr: z.string().nullable(),
  primaryBarcode: barcode.nullable(),
  defaultUnitNameAr: z.string().nullable(),
  defaultPrice: money.nullable(),
  isWeighed: z.boolean(),
  isActive: z.boolean(),
})
export type ProductListItem = z.infer<typeof productListItem>

export const productListQuery = z.object({
  q: z.string().max(120).optional(),
  categoryId: uuid.optional(),
  isActive: z.stringbool().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
})
export type ProductListQuery = z.infer<typeof productListQuery>

/**
 * نتيجة مسح الباركود — المسار الأسرع في النظام (docs/02 §5.1، هدفه < 5ms).
 * `scannedBarcode` يحفظ ما قُرئ فعلاً لأن باركود الميزان يحمل وزناً مضمّناً (02 §5.2).
 */
export const barcodeLookupResult = z.object({
  productId: uuid,
  nameAr: z.string(),
  productUnitId: uuid,
  unitNameAr: z.string(),
  factor: quantity,
  price: money.nullable(),
  minPrice: money.nullable(),
  isWeighed: z.boolean(),
  trackExpiry: z.boolean(),
  scannedBarcode: z.string(),
  /** الكمية المستخرجة من باركود الميزان إن كان كذلك، وإلا null */
  weightFromBarcode: quantity.nullable(),
})
export type BarcodeLookupResult = z.infer<typeof barcodeLookupResult>
