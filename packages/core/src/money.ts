/**
 * المال في @falak/core — غلاف رقيق حول decimal.js.
 *
 * ADR-002:
 *  - كل عملية حسابية على المال تمر من هنا. `number` للعرض النهائي فقط.
 *  - كل قيمة مالية تُنقل **كنص** (`"1248.50"`) لا كرقم JSON.
 *  - **دالة تقريب واحدة في الحزمة كلها**: `roundMoney(value, decimals)`،
 *    و`decimals` يأتي من `currencies.decimals` (شيكل 2، دينار أردني 3).
 *  - **الجمع قبل التقريب**: تُجمع الأسطر بدقة كاملة ويُقرَّب الإجمالي مرة واحدة.
 *
 * لماذا لا نستخدم `primitives.money` من @falak/contracts للتحقق هنا؟
 * لأن ذلك المخطط مقيّد بمنزلتين (مطابقةً لـ `numeric(14,2)` على الحدود)،
 * بينما هذه الحزمة تحسب بدقّة كاملة وتقرّب حسب العملة — والدينار ثلاث منازل.
 * التحقق هنا على **الصيغة** لا على عدد المنازل؛ عدد المنازل تفرضه العملة عند
 * التقريب، ويفرضه zod و`numeric()` عند حدود الـ API والقاعدة.
 */
import { percent } from '@falak/contracts'
import { Decimal } from 'decimal.js'
import { CORE_ERROR, CoreError, coreMessages } from './errors.js'

/** دقّة الحساب الداخلي: أعلى بكثير من أي عملة، فلا يظهر خطأ قبل التقريب النهائي. */
export const DECIMAL_PRECISION = 34

/** أقصى عدد منازل عشرية تقبله دالة التقريب (سعر الصرف `numeric(14,6)` هو الأوسع). */
export const MAX_DECIMALS = 6

/** منازل الكميات: `numeric(14,3)` — الوزن بالغرام (docs/02-database.md §1). */
export const QTY_DECIMALS = 3

/**
 * نسخة مضبوطة من Decimal خاصة بالحزمة.
 * `clone` بدل `Decimal.set` حتى لا نغيّر السلوك العام لأي مستورد آخر لـ decimal.js.
 * التقريب التجاري: نصف لأعلى (`ROUND_HALF_UP`) — ما يتوقعه الزبون على الفاتورة.
 */
export const Dec = Decimal.clone({
  precision: DECIMAL_PRECISION,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -30,
  toExpPos: 40,
})

/** صيغة الرقم النصي المقبولة: اختياري السالب، خانات، وكسر اختياري. لا أُسّي ولا فراغات. */
const NUMERIC_STRING = /^-?\d{1,15}(\.\d{1,15})?$/

/** ما يُقبل كمدخل مالي: نص (المصدر الرسمي) أو Decimal (قيمة وسيطة داخل الحزمة). */
export type DecimalLike = string | Decimal

/** العملة كما تصل من `currencies` — الرمز وعدد المنازل. */
export type Currency = {
  code: string
  decimals: number
  /** رمز العرض (₪، د.أ، $). اختياري: التنسيق يعمل بدونه. */
  symbol?: string
}

export const ZERO = new Dec(0)

/** يحوّل نصاً أو Decimal إلى Decimal بدقّة الحزمة، ويرفض ما ليس رقماً برسالة عربية. */
export function toDecimal(value: DecimalLike, field = 'قيمة'): Decimal {
  if (value instanceof Decimal) {
    if (!value.isFinite()) throw invalidNumber(field, value.toString())
    return new Dec(value)
  }
  if (typeof value !== 'string' || !NUMERIC_STRING.test(value)) {
    throw invalidNumber(field, value)
  }
  return new Dec(value)
}

/** يحوّل ويرفض السالب معاً — للحقول التي لا معنى للسالب فيها (كمية، سعر، خصم، دفعة). */
export function toNonNegativeDecimal(value: DecimalLike, field: string): Decimal {
  const d = toDecimal(value, field)
  if (d.isNegative()) {
    throw new CoreError(
      CORE_ERROR.NEGATIVE_NOT_ALLOWED,
      coreMessages.negativeNotAllowed(field, d.toString()),
      field
    )
  }
  return d
}

/** قاسم تحويل النسبة المئوية إلى معامل عشري. */
export const PERCENT_DIVISOR = '100'

/**
 * يقرأ نسبة مئوية نصاً (`"16.000"`) ويعيد معاملها العشري (`0.16`).
 * الصيغة من مخطط `percent` في @falak/contracts (`numeric(6,3)`، بين 0 و100)
 * — مصدر واحد للصيغة، ولأنها لا تقبل السالب فالمقام `1 + r` لا يصير صفراً أبداً.
 */
export function parsePercentFactor(value: string, field: string, label: string): Decimal {
  const parsed = percent.safeParse(value)
  if (!parsed.success) {
    throw new CoreError(
      CORE_ERROR.INVALID_PERCENT,
      coreMessages.invalidPercent(label, value),
      field
    )
  }
  return new Dec(parsed.data).div(PERCENT_DIVISOR)
}

/* ── الحساب: كله بدقّة كاملة، بلا أي تقريب ────────────────────────────── */

export function add(a: DecimalLike, b: DecimalLike): Decimal {
  return toDecimal(a).plus(toDecimal(b))
}

export function sub(a: DecimalLike, b: DecimalLike): Decimal {
  return toDecimal(a).minus(toDecimal(b))
}

export function mul(a: DecimalLike, b: DecimalLike): Decimal {
  return toDecimal(a).times(toDecimal(b))
}

export function div(a: DecimalLike, b: DecimalLike): Decimal {
  const divisor = toDecimal(b)
  if (divisor.isZero()) throw invalidNumber('مقسوم عليه', '0')
  return toDecimal(a).div(divisor)
}

/** جمع بدقّة كاملة — الأساس الذي يمنع تراكم أخطاء التقريب عبر الأسطر. */
export function sum(values: readonly DecimalLike[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(toDecimal(v)), new Dec(0))
}

export function isZero(value: DecimalLike): boolean {
  return toDecimal(value).isZero()
}

export function isNegative(value: DecimalLike): boolean {
  return toDecimal(value).isNegative()
}

export function gt(a: DecimalLike, b: DecimalLike): boolean {
  return toDecimal(a).gt(toDecimal(b))
}

/* ── التقريب: الدالة الوحيدة في الحزمة ─────────────────────────────────── */

/**
 * **دالة التقريب الوحيدة في @falak/core** (ADR-002 §4).
 * `decimals` يأتي من `currencies.decimals` — لا رقمين ثابتين.
 * تعيد نصاً بعدد المنازل المطلوب بالضبط، فلا يفسده `JSON.parse` لاحقاً.
 */
export function roundMoney(value: DecimalLike, decimals: number): string {
  assertDecimals(decimals)
  const rounded = toDecimal(value).toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP)
  // يمنع "‎-0.00" الناتج عن تقريب كسر سالب صغير جداً
  return (rounded.isZero() ? new Dec(0) : rounded).toFixed(decimals)
}

/** صفر منسّق بعدد منازل العملة (`"0.00"` للشيكل، `"0.000"` للدينار). */
export function zeroAmount(decimals: number): string {
  return roundMoney(ZERO, decimals)
}

/** يتحقق أن عدد المنازل عدد صحيح ضمن المدى، وإلا رفض برسالة عربية. */
export function assertDecimals(decimals: number): number {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > MAX_DECIMALS) {
    throw new CoreError(
      CORE_ERROR.INVALID_DECIMALS,
      coreMessages.invalidDecimals(decimals, MAX_DECIMALS),
      'decimals'
    )
  }
  return decimals
}

/**
 * توزيع فروق التقريب (طريقة أكبر الباقي).
 *
 * تأخذ قيماً دقيقة وإجمالاً **مقرَّباً مسبقاً**، وتعيد قيماً مقرَّبة
 * **مجموعها يساوي الإجمالي بالضبط** — فلا يضيع قرش بين الأسطر.
 * الوحدة الموزَّعة `10^-decimals` تذهب للأسطر الأكبر باقياً، والتعادل يُحسم
 * بترتيب السطر فيكون الناتج ثابتاً (deterministic) عبر التشغيلات.
 */
export function allocateRounded(
  values: readonly DecimalLike[],
  roundedTotal: DecimalLike,
  decimals: number
): string[] {
  assertDecimals(decimals)
  if (values.length === 0) return []

  const entries = values.map((value, index) => {
    const exact = toDecimal(value)
    const rounded = new Dec(roundMoney(exact, decimals))
    return { index, remainder: exact.minus(rounded), rounded }
  })

  const unit = new Dec(10).pow(-decimals)
  const naiveTotal = entries.reduce((acc, e) => acc.plus(e.rounded), new Dec(0))
  const steps = toDecimal(roundedTotal).minus(naiveTotal).div(unit).round().toNumber()

  if (steps !== 0) {
    // فرق موجب ⇒ الوحدات لأكبر باقٍ؛ فرق سالب ⇒ لأصغره. التعادل بترتيب السطر.
    const direction = steps > 0 ? unit : unit.negated()
    const order = [...entries].sort((a, b) =>
      steps > 0
        ? b.remainder.comparedTo(a.remainder) || a.index - b.index
        : a.remainder.comparedTo(b.remainder) || a.index - b.index
    )
    for (let taken = 0; taken < Math.abs(steps); taken += 1) {
      const target = order[taken % order.length]
      if (target) target.rounded = target.rounded.plus(direction)
    }
  }

  return entries.map((e) => roundMoney(e.rounded, decimals))
}

/* ── العرض: هنا فقط يجوز `number` (ADR-002 §2) ─────────────────────────── */

/**
 * تنسيق مبلغ للعرض: أرقام غربية، فاصلة آلاف، والرمز بعد الرقم
 * (`1,248.50 ₪` — docs/03-design-system.md §7).
 */
export function formatMoney(value: DecimalLike, currency: Currency): string {
  const text = formatNumber(value, currency.decimals)
  return currency.symbol ? `${text} ${currency.symbol}` : text
}

/** تنسيق رقم بفاصلة آلاف بعد تقريبه. للكميات مرّر `QTY_DECIMALS`. */
export function formatNumber(value: DecimalLike, decimals: number): string {
  const [intPart = '0', fracPart] = roundMoney(value, decimals).split('.')
  const sign = intPart.startsWith('-') ? '-' : ''
  const digits = sign ? intPart.slice(1) : intPart
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return fracPart ? `${sign}${grouped}.${fracPart}` : `${sign}${grouped}`
}

/**
 * تحويل للعرض فقط (رسم شريط، مقارنة بصرية). **لا تُستخدم في أي حساب مالي**
 * — ADR-002 §2: `number` بعد التقريب النهائي وللعرض حصراً.
 */
export function toDisplayNumber(value: DecimalLike, decimals: number): number {
  return Number(roundMoney(value, decimals))
}

function invalidNumber(field: string, value: unknown): CoreError {
  return new CoreError(CORE_ERROR.INVALID_NUMBER, coreMessages.invalidNumber(field, value), field)
}
