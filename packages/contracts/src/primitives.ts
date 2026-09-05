import { z } from 'zod'

/**
 * أنواع أوّلية مشتركة. المرجع: docs/02-database.md §1 (الأنواع الرقمية) وADR-002.
 *
 * قاعدة حاكمة: **كل قيمة مالية أو كمية تعبر الـ API كنص** لا كرقم JSON،
 * لأن `JSON.parse` يحوّلها إلى double فيفسد الدقة. التحويل إلى Decimal
 * يتم في `@falak/core` عند الحدود.
 */

export const uuid = z.uuid('معرّف غير صالح')

/** مبلغ: numeric(14,2) — نص برقمين عشريين كحد أقصى، موجب أو سالب */
export const money = z
  .string()
  .regex(/^-?\d{1,12}(\.\d{1,2})?$/, 'مبلغ غير صالح (رقمان عشريان كحد أقصى)')

/** كمية: numeric(14,3) — الوزن بالغرام يحتاج ثلاث منازل */
export const quantity = z
  .string()
  .regex(/^-?\d{1,11}(\.\d{1,3})?$/, 'كمية غير صالحة (ثلاث منازل عشرية كحد أقصى)')

/** تكلفة الوحدة: numeric(14,4) */
export const unitCost = z
  .string()
  .regex(/^-?\d{1,10}(\.\d{1,4})?$/, 'تكلفة غير صالحة (أربع منازل عشرية كحد أقصى)')

/** سعر صرف: numeric(14,6) */
export const exchangeRate = z.string().regex(/^\d{1,8}(\.\d{1,6})?$/, 'سعر صرف غير صالح')

/** نسبة مئوية: numeric(6,3) — 0 إلى 100 */
export const percent = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,3})?$/, 'نسبة غير صالحة')
  .refine((v) => Number(v) <= 100, 'النسبة لا تتجاوز 100')

/** رمز عملة ISO-4217: char(3) */
export const currencyCode = z
  .string()
  .length(3, 'رمز العملة ثلاثة أحرف')
  .regex(/^[A-Z]{3}$/, 'رمز العملة بأحرف لاتينية كبيرة')

/** باركود: أرقام فقط، 4 إلى 24 خانة (EAN-8/13، UPC، Code128 رقمي، باركود ميزان) */
export const barcode = z.string().regex(/^\d{4,24}$/, 'الباركود أرقام فقط بين 4 و24 خانة')

/** ترقيم صفحات موحّد — 50 صفاً افتراضياً (docs/03-design-system.md §6.4) */
export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(50),
})
export type Pagination = z.infer<typeof pagination>

export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    rows: z.array(item),
    total: z.number().int().nonnegative(),
    page: z.number().int().min(1),
    perPage: z.number().int().min(1),
  })
}

/** شكل الخطأ الموحّد من الوكيل. الرسالة عربية وتقول ما العمل (docs/03 §7). */
export const apiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    field: z.string().optional(),
  }),
})
export type ApiError = z.infer<typeof apiError>
