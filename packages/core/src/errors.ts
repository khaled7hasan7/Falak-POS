/**
 * أخطاء الحساب في @falak/core.
 *
 * القاعدة 7.2 في CLAUDE.md: لا قيم سحرية — الرموز والرسائل في مكان واحد.
 * الرسائل عربية وتقول **ما حدث وما العمل** (docs/03-design-system.md §7).
 * الرمز (`code`) يطابق شكل الخطأ الموحّد في `packages/contracts/src/primitives.ts`
 * (`apiError.error.code`) فيمرّره الوكيل كما هو بلا ترجمة إضافية.
 */

export const CORE_ERROR = {
  /** نص لا يمثّل رقماً بصيغة صالحة */
  INVALID_NUMBER: 'core.invalid_number',
  /** عدد منازل عشرية خارج المدى المسموح */
  INVALID_DECIMALS: 'core.invalid_decimals',
  /** قيمة سالبة في موضع لا يقبل السالب */
  NEGATIVE_NOT_ALLOWED: 'core.negative_not_allowed',
  /** معامل تحويل الوحدة صفر أو سالب */
  INVALID_FACTOR: 'core.invalid_factor',
  /** نسبة مئوية غير صالحة (سالبة أو أكبر من 100) */
  INVALID_PERCENT: 'core.invalid_percent',
  /** سعر صرف صفر أو سالب */
  INVALID_EXCHANGE_RATE: 'core.invalid_exchange_rate',
  /** رمز عملة غير صالح */
  INVALID_CURRENCY_CODE: 'core.invalid_currency_code',
  /** خصم السطر أكبر من قيمة السطر */
  LINE_DISCOUNT_TOO_LARGE: 'core.line_discount_too_large',
  /** خصم الفاتورة أكبر من إجمالي الفاتورة */
  INVOICE_DISCOUNT_TOO_LARGE: 'core.invoice_discount_too_large',
  /** فاتورة بلا أسطر */
  EMPTY_INVOICE: 'core.empty_invoice',
  /** دفع أكبر من الإجمالي بلا عملة باقٍ محدّدة */
  CHANGE_CURRENCY_MISSING: 'core.change_currency_missing',
  /** وحدة التقريب النقدي صفر أو سالبة */
  INVALID_ROUNDING_INCREMENT: 'core.invalid_rounding_increment',
} as const

export type CoreErrorCode = (typeof CORE_ERROR)[keyof typeof CORE_ERROR]

/** خطأ حساب. `field` اسم الحقل المسبِّب ليضيء في الواجهة. */
export class CoreError extends Error {
  readonly code: CoreErrorCode
  readonly field: string | undefined

  constructor(code: CoreErrorCode, message: string, field?: string) {
    super(message)
    this.name = 'CoreError'
    this.code = code
    this.field = field
  }
}

/**
 * رسائل الأخطاء. دوال لا نصوص جامدة لأن كل رسالة تعرض القيم الفعلية،
 * فيرى الكاشير الرقمين ويعرف كم يخفّض.
 */
export const coreMessages = {
  invalidNumber: (field: string, value: unknown) =>
    `القيمة في «${field}» ليست رقماً صالحاً (${describe(value)}). أدخل رقماً بصيغة 1234.56`,
  invalidDecimals: (decimals: unknown, max: number) =>
    `عدد المنازل العشرية غير صالح (${describe(decimals)}). المسموح عدد صحيح بين 0 و${max} ويؤخذ من العملة`,
  negativeNotAllowed: (field: string, value: string) =>
    `القيمة في «${field}» سالبة (${value}) ولا معنى لها هنا. أدخل قيمة صفر أو أكبر`,
  invalidFactor: (factor: string) =>
    `معامل تحويل الوحدة غير صالح (${factor}). يجب أن يكون أكبر من صفر — راجع وحدات الصنف`,
  invalidPercent: (field: string, value: unknown) =>
    `النسبة في «${field}» غير صالحة (${describe(value)}). أدخل نسبة بين 0 و100 مثل 16.000`,
  invalidExchangeRate: (value: unknown) =>
    `سعر الصرف غير صالح (${describe(value)}). يجب أن يكون أكبر من صفر — حدّثه من الإعدادات`,
  invalidCurrencyCode: (value: unknown) =>
    `رمز العملة غير صالح (${describe(value)}). المطلوب ثلاثة أحرف لاتينية كبيرة مثل ILS`,
  lineDiscountTooLarge: (discount: string, gross: string) =>
    `الخصم (${discount}) أكبر من قيمة السطر (${gross}). قلّل الخصم أو زد الكمية`,
  invoiceDiscountTooLarge: (discount: string, base: string) =>
    `خصم الفاتورة (${discount}) أكبر من إجمالي الأسطر (${base}). قلّل الخصم`,
  emptyInvoice: () => 'لا يمكن حساب فاتورة بلا أسطر. أضف صنفاً واحداً على الأقل',
  changeCurrencyMissing: (change: string) =>
    `الدفع أكبر من الإجمالي والباقي ${change}. حدّد عملة الباقي قبل الإتمام`,
  invalidRoundingIncrement: (value: string) =>
    `وحدة التقريب النقدي غير صالحة (${value}). يجب أن تكون أكبر من صفر مثل 0.10`,
} as const

/** يعرض القيمة في الرسالة بلا كسرها إن كانت غير نصية أو فارغة. */
function describe(value: unknown): string {
  if (typeof value === 'string') return value.length === 0 ? 'فارغة' : value
  if (value === null || value === undefined) return 'فارغة'
  return String(value)
}
