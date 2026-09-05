/**
 * التقريب النقدي الاختياري — تقريب الإجمالي **النقدي** لأقرب وحدة متداولة
 * (نصف شيكل، عشرة أغورات…) لأن الفكّة الصغيرة غير متوفرة في الدرج.
 *
 * **معطّل افتراضياً.** يفعّله المستأجر من الإعدادات بالمفتاح `pos.cash_rounding`
 * الموصوف في `docs/adr/ADR-004-cash-rounding.md` (مفتاح جديد أُضيف لأنه غير
 * موجود في `docs/02-database.md` §12.5 — القاعدة 7: لا انحراف صامت).
 *
 * الدالة **نقية**: تأخذ الإعداد وسيطاً ولا تقرأ `tenants.settings` بنفسها.
 * التطبيق مسؤولية المستدعي: يُطبَّق على الدفع النقدي فقط، لا على البطاقة
 * ولا على الآجل، وفرق التقريب (`adjustment`) يُسجَّل كي يوازن الصندوق.
 */
import { CORE_ERROR, CoreError, coreMessages } from './errors.js'
import { Decimal } from 'decimal.js'
import { type Currency, roundMoney, sub, toDecimal, toNonNegativeDecimal } from './money.js'

/** مفتاح الإعداد في `tenants.settings` (ADR-004). */
export const CASH_ROUNDING_SETTING_KEY = 'pos.cash_rounding'

export const CASH_ROUNDING_MODE = {
  /** لأقرب وحدة (المعتاد) */
  NEAREST: 'nearest',
  /** لأعلى دائماً — لصالح المحل */
  UP: 'up',
  /** لأسفل دائماً — لصالح الزبون */
  DOWN: 'down',
} as const

export type CashRoundingMode = (typeof CASH_ROUNDING_MODE)[keyof typeof CASH_ROUNDING_MODE]

export type CashRoundingSetting = {
  enabled: boolean
  /** وحدة التقريب نصاً: `"0.10"` أصغر قطعة شيكل متداولة، `"0.50"` نصف شيكل */
  increment: string
  mode: CashRoundingMode
}

/** القيمة الافتراضية للمفتاح: **معطّل** (ADR-004). */
export const DEFAULT_CASH_ROUNDING: CashRoundingSetting = {
  enabled: false,
  increment: '0.10',
  mode: CASH_ROUNDING_MODE.NEAREST,
}

export type CashRoundingResult = {
  /** الإجمالي بعد التقريب النقدي */
  total: string
  /** الفرق (مقرَّب − أصلي): موجب لصالح المحل، سالب لصالح الزبون */
  adjustment: string
}

/**
 * يطبّق التقريب النقدي على إجمالي. الإعداد معطّل ⇒ يعيد الإجمالي مقرَّباً
 * بمنازل العملة فقط وفرقاً صفراً، فيُستدعى دائماً بلا شرط عند المستدعي.
 */
export function applyCashRounding(
  total: string,
  setting: CashRoundingSetting,
  currency: Currency
): CashRoundingResult {
  const decimals = currency.decimals
  const exact = toNonNegativeDecimal(total, 'الإجمالي النقدي')
  const rounded = roundMoney(exact, decimals)

  if (!setting.enabled) {
    return { total: rounded, adjustment: roundMoney(sub(rounded, exact), decimals) }
  }

  const increment = assertIncrement(setting.increment)
  const steps = quantize(exact.div(increment), setting.mode)
  const adjusted = roundMoney(steps.times(increment), decimals)
  return { total: adjusted, adjustment: roundMoney(sub(adjusted, exact), decimals) }
}

/** يقرّب عدد الوحدات حسب النمط. `nearest` تجارية: النصف لأعلى. */
function quantize(steps: Decimal, mode: CashRoundingMode): Decimal {
  if (mode === CASH_ROUNDING_MODE.UP) return steps.ceil()
  if (mode === CASH_ROUNDING_MODE.DOWN) return steps.floor()
  return steps.toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
}

/** وحدة التقريب يجب أن تكون أكبر من صفر، وإلا استحالت القسمة عليها. */
function assertIncrement(increment: string): Decimal {
  const value = toDecimal(increment, 'وحدة التقريب النقدي')
  if (!value.isPositive() || value.isZero()) {
    throw new CoreError(
      CORE_ERROR.INVALID_ROUNDING_INCREMENT,
      coreMessages.invalidRoundingIncrement(increment),
      CASH_ROUNDING_SETTING_KEY
    )
  }
  return value
}
