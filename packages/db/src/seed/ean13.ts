/**
 * باركود البذرة — يبني على حساب EAN-13 المشترك في `@falak/core`.
 *
 * ما يخصّ البذرة وحدها يبقى هنا (البادئات الواقعية والتسلسل الحتمي)، وما
 * يستعمله الوكيل والواجهة أيضاً يعيش في `@falak/core/barcode` (CLAUDE.md §7.2).
 *
 * القيد الحاكم من `docs/02-database.md §5.2`: البادئة `2` محجوزة لباركود الميزان،
 * فلا يبدأ بها باركود صنف عادي — واختبار البذرة يفرضه.
 */
export { ean13CheckDigit, isValidEan13, toEan13, SCALE_BARCODE_PREFIX } from '@falak/core'
import { toEan13 } from '@falak/core'

/** البادئات المستخدمة في البذرة — واقعية لسوق فلسطين والأردن، ولا تبدأ بـ 2 */
export const SEED_BARCODE_PREFIXES = ['625', '628', '729'] as const

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
