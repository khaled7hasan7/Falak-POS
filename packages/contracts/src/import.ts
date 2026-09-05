import { z } from 'zod'
import { barcode, money, quantity, uuid } from './primitives.js'

/**
 * استيراد الأصناف من Excel (المهمة 1.4 · docs/04-execution-plan.md).
 * التدفّق: رفع ← معاينة (اكتشاف الأعمدة + أول 20 صفاً) ← تنفيذ ← تقرير لكل صف.
 */

/** الأعمدة التي يفهمها المستورد. `null` = العمود غير موجود في الملف. */
export const importColumnMap = z.object({
  nameAr: z.string().nullable(),
  nameEn: z.string().nullable(),
  sku: z.string().nullable(),
  barcode: z.string().nullable(),
  categoryName: z.string().nullable(),
  unitName: z.string().nullable(),
  price: z.string().nullable(),
  minPrice: z.string().nullable(),
  cost: z.string().nullable(),
  minStock: z.string().nullable(),
  manufacturer: z.string().nullable(),
})
export type ImportColumnMap = z.infer<typeof importColumnMap>

/** صف كما قُرئ من الملف بعد تطبيق خريطة الأعمدة. */
export const importRow = z.object({
  rowNumber: z.number().int().min(1),
  nameAr: z.string().nullable(),
  nameEn: z.string().nullable(),
  sku: z.string().nullable(),
  barcode: z.string().nullable(),
  categoryName: z.string().nullable(),
  unitName: z.string().nullable(),
  price: z.string().nullable(),
  minPrice: z.string().nullable(),
  cost: z.string().nullable(),
  minStock: z.string().nullable(),
  manufacturer: z.string().nullable(),
})
export type ImportRow = z.infer<typeof importRow>

export const importPreviewResponse = z.object({
  uploadId: uuid,
  fileName: z.string(),
  totalRows: z.number().int().nonnegative(),
  detectedColumns: importColumnMap,
  headers: z.array(z.string()),
  /** أول 20 صفاً فقط للمعاينة */
  sample: z.array(importRow),
  /** أخطاء ظهرت في المعاينة (عمود إلزامي مفقود مثلاً) */
  warnings: z.array(z.string()),
})
export type ImportPreviewResponse = z.infer<typeof importPreviewResponse>

export const importCommitRequest = z.object({
  uploadId: uuid,
  /** خريطة معدّلة يدوياً من الواجهة إن لم يكن الاكتشاف صحيحاً */
  columnMap: importColumnMap.optional(),
  priceListId: uuid,
  /** التصنيف الافتراضي لصفوف بلا تصنيف */
  defaultCategoryId: uuid.nullable().optional(),
  /** الوحدة الأساسية الافتراضية لصفوف بلا وحدة */
  defaultUnitId: uuid,
  /** صنف موجود بنفس الباركود: يُحدَّث أم يُتخطّى */
  onDuplicate: z.enum(['skip', 'update']).default('skip'),
})
export type ImportCommitRequest = z.infer<typeof importCommitRequest>

/** نتيجة صف واحد — الوثيقة تطلب تقريراً لكل صف: نجح أم فشل ولماذا. */
export const importRowResult = z.object({
  rowNumber: z.number().int().min(1),
  status: z.enum(['created', 'updated', 'skipped', 'failed']),
  productId: uuid.nullable(),
  nameAr: z.string().nullable(),
  /** رسالة عربية تقول ما المشكلة وكيف تُحل (docs/03 §7) */
  message: z.string().nullable(),
})
export type ImportRowResult = z.infer<typeof importRowResult>

export const importCommitResponse = z.object({
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  rows: z.array(importRowResult),
})
export type ImportCommitResponse = z.infer<typeof importCommitResponse>

/** أعمدة ملف القالب الذي يُنزّله المستخدم ليملأه. */
export const importTemplateRow = z.object({
  nameAr: z.string(),
  barcode: barcode.optional(),
  categoryName: z.string().optional(),
  unitName: z.string().optional(),
  price: money.optional(),
  minStock: quantity.optional(),
})
export type ImportTemplateRow = z.infer<typeof importTemplateRow>
