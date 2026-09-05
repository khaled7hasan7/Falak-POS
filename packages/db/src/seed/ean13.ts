/**
 * توليد باركود EAN-13 والتحقق منه.
 *
 * قيد حاكم من `docs/02-database.md §5.2`: البادئة `2` محجوزة **لباركود الميزان**
 * (وزن أو سعر مضمّن)، فالوكيل يحلّل أي باركود يبدأ بها كباركود ميزان قبل أن
 * يستعلم عن `product_barcodes`. لذلك **ممنوع** أن يبدأ باركود صنف عادي بـ `2`.
 */

/** البادئات المستخدمة في البذرة — واقعية لسوق فلسطين والأردن، ولا تبدأ بـ 2 */
export const SEED_BARCODE_PREFIXES = ['625', '628', '729'] as const

/** البادئة المحجوزة لباركود الميزان (`docs/02-database.md §5.2`) */
export const SCALE_BARCODE_PREFIX = '2'

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

/**
 * باركود بذرة حتمي: بادئة + تسلسل مصفوف بأصفار + رقم تحقق.
 * `serial` يجب أن يكون فريداً داخل نفس البادئة.
 */
export function seedBarcode(prefixIndex: number, serial: number): string {
  const prefix = SEED_BARCODE_PREFIXES[prefixIndex % SEED_BARCODE_PREFIXES.length]!
  const body = String(serial).padStart(9, '0')
  if (body.length > 9) {
    throw new Error(`التسلسل ${serial} أطول من تسع خانات`)
  }
  return toEan13(prefix + body)
}
