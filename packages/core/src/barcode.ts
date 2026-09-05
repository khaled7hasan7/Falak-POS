/**
 * الباركود: حساب رقم التحقق والتحقق من الصحة وتوليد باركود داخلي.
 *
 * هنا لا في حزمة أخرى، لأن ثلاثة مستهلكين يحتاجونه: بذرة القاعدة، ومولّد
 * الباركود الداخلي في الوكيل، ونموذج الصنف في الواجهة (CLAUDE.md §7.2 — DRY).
 *
 * قيدان حاكمان:
 *  - البادئة `2` محجوزة **لباركود الميزان** (`docs/02-database.md §5.2`)، فالوكيل
 *    يحلّل ما يبدأ بها كوزن مضمّن قبل أن يستعلم عن `product_barcodes`. لذلك
 *    **ممنوع** أن يبدأ باركود صنف عادي بها.
 *  - الباركود الداخلي يستعمل `040` من نطاق GS1 للتداول المحصور (ADR-005)، فلا
 *    يصطدم بالميزان ولا ينتحل بادئة شركة حقيقية.
 */

/** البادئة المحجوزة لباركود الميزان (`docs/02-database.md §5.2`) */
export const SCALE_BARCODE_PREFIX = '2'

/** بادئة الباركود الداخلي المولَّد داخل المحل (ADR-005) */
export const INTERNAL_BARCODE_PREFIX = '040'

/** طول EAN-13 كاملاً برقم التحقق */
export const EAN13_LENGTH = 13

/**
 * رقم التحقق لـ EAN-13: تُوزن الخانات 1×,3×,1×… من اليسار على أول 12 خانة،
 * ورقم التحقق هو مكمّل المجموع لأقرب مضاعف للعشرة.
 */
export function ean13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) {
    throw new Error(`EAN-13 يحتاج 12 رقماً لحساب رقم التحقق، وصل: "${first12}"`)
  }
  let sum = 0
  for (let i = 0; i < 12; i++) {
    sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3)
  }
  return (10 - (sum % 10)) % 10
}

/** يبني باركود EAN-13 كاملاً من 12 خانة بإضافة رقم التحقق */
export function toEan13(first12: string): string {
  return first12 + String(ean13CheckDigit(first12))
}

/** يتحقق من صحة باركود EAN-13 كامل (13 خانة برقم تحقق صحيح) */
export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false
  return ean13CheckDigit(code.slice(0, 12)) === Number(code[12])
}

/** هل هذا باركود ميزان (وزن أو سعر مضمّن)؟ (`docs/02 §5.2`) */
export function isScaleBarcode(code: string): boolean {
  return code.startsWith(SCALE_BARCODE_PREFIX)
}

/**
 * باركود داخلي حتمي من تسلسل: `040` + تسلسل بتسع خانات + رقم تحقق.
 * التسلسل يجب أن يكون فريداً داخل المستأجر — من يولّده مسؤول عن ذلك.
 */
export function internalBarcode(serial: number): string {
  if (!Number.isInteger(serial) || serial < 0) {
    throw new Error(`تسلسل الباركود الداخلي يجب أن يكون عدداً صحيحاً غير سالب، وصل: ${serial}`)
  }
  const body = String(serial).padStart(9, '0')
  if (body.length > 9) {
    throw new Error(`التسلسل ${serial} أطول من تسع خانات`)
  }
  return toEan13(INTERNAL_BARCODE_PREFIX + body)
}

/** التسلسل داخل باركود داخلي، أو `null` إن لم يكن داخلياً */
export function internalBarcodeSerial(code: string): number | null {
  if (!isValidEan13(code) || !code.startsWith(INTERNAL_BARCODE_PREFIX)) return null
  return Number(code.slice(INTERNAL_BARCODE_PREFIX.length, 12))
}
