/**
 * الضريبة: شاملة (السعر يحتويها) أو مضافة (تُضاف فوق السعر).
 *
 * `taxes.is_inclusive` في docs/02-database.md يحدّد النوع، و`taxes.rate`
 * نسبة مئوية `numeric(6,3)` تصل كنص (`"16.000"`).
 *
 *   الشاملة: net = gross ÷ (1 + r)   ·   tax = gross − net
 *   المضافة: tax = net × r           ·   gross = net + tax
 *
 * لا قسمة على صفر ممكنة: `percent` في @falak/contracts يرفض السالب،
 * فالمقام `1 + r ≥ 1` دائماً. ونسبة الصفر تعطي ضريبة صفر في النوعين.
 */
import {
  type Currency,
  type DecimalLike,
  parsePercentFactor,
  roundMoney,
  toDecimal,
  ZERO,
} from './money.js'
import type { Decimal } from 'decimal.js'

/** نوع الضريبة: `is_inclusive = true` ⇒ `inclusive`. */
export const TAX_MODE = {
  INCLUSIVE: 'inclusive',
  EXCLUSIVE: 'exclusive',
} as const

export type TaxMode = (typeof TAX_MODE)[keyof typeof TAX_MODE]

/** نسبة الضريبة الافتراضية حين لا ضريبة على الصنف (`sale_lines.tax_rate` افتراضه 0). */
export const ZERO_RATE = '0'

/** تقسيم مبلغ إلى صافٍ وضريبة، بدقّة كاملة وبلا أي تقريب. */
export type TaxSplit = {
  /** الصافي قبل الضريبة */
  net: Decimal
  /** مبلغ الضريبة */
  tax: Decimal
  /** المستحق فعلاً = net + tax */
  total: Decimal
}

/** يحوّل نسبة الضريبة نصاً إلى معامل عشري (`"16.000"` ⇒ `0.16`). */
export function taxFactor(ratePercent: string): Decimal {
  return parsePercentFactor(ratePercent, 'taxRate', 'نسبة الضريبة')
}

/**
 * يقسم مبلغاً حسب نوع الضريبة. المبلغ بأساس الأسعار المدخلة:
 * في الشاملة هو المستحق (يحتوي الضريبة)، وفي المضافة هو الصافي.
 * يُستدعى **بعد** خصم السطر وحصة خصم الفاتورة، فيبقى وعاء الضريبة صحيحاً.
 */
export function splitTax(amount: DecimalLike, ratePercent: string, mode: TaxMode): TaxSplit {
  const value = toDecimal(amount, 'المبلغ الخاضع للضريبة')
  const rate = taxFactor(ratePercent)

  if (rate.isZero()) return { net: value, tax: ZERO, total: value }

  if (mode === TAX_MODE.INCLUSIVE) {
    const net = value.div(rate.plus(1))
    return { net, tax: value.minus(net), total: value }
  }

  const tax = value.times(rate)
  return { net: value, tax, total: value.plus(tax) }
}

/** غلاف نصّي لـ `splitTax` — للاستدعاء المباشر ولاختبار التكافؤ بين النوعين. */
export function calcTax(
  amount: string,
  ratePercent: string,
  mode: TaxMode,
  currency: Currency
): { net: string; tax: string; total: string } {
  const split = splitTax(amount, ratePercent, mode)
  return {
    net: roundMoney(split.net, currency.decimals),
    tax: roundMoney(split.tax, currency.decimals),
    total: roundMoney(split.total, currency.decimals),
  }
}
