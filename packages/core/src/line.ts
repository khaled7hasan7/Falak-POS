/**
 * حساب سطر فاتورة (`sale_lines`).
 *
 *   gross    = qty × unitPrice
 *   discount = مبلغ أو نسبة من gross   ← **أكبر من gross يُرفض بخطأ، ولا يُقصّ صامتاً**
 *   taxable  = gross − discount
 *   ثم الضريبة حسب نوعها (tax.ts)، والناتج net و taxAmount و lineTotal.
 *
 * الأرقام هنا **بلا تقريب**؛ التقريب مرة واحدة في `calcLine` أو في `calcInvoice`
 * بعد جمع كل الأسطر (ADR-002 §5).
 */
import { CORE_ERROR, CoreError, coreMessages } from './errors.js'
import {
  type Currency,
  type DecimalLike,
  parsePercentFactor,
  roundMoney,
  sub,
  toDecimal,
  toNonNegativeDecimal,
  ZERO,
} from './money.js'
import { splitTax, TAX_MODE, type TaxMode, ZERO_RATE } from './tax.js'
import { assertQuantity } from './units.js'
import type { Decimal } from 'decimal.js'

/** الخصم إمّا مبلغ ثابت وإمّا نسبة مئوية من قيمة السطر. */
export const DISCOUNT_KIND = {
  AMOUNT: 'amount',
  PERCENT: 'percent',
} as const

export type DiscountKind = (typeof DISCOUNT_KIND)[keyof typeof DISCOUNT_KIND]

export type Discount = {
  kind: DiscountKind
  /** مبلغ (`"5.00"`) أو نسبة (`"10.000"`) حسب `kind` */
  value: string
}

export type LineInput = {
  /** بالوحدة المختارة — `sale_lines.qty` numeric(14,3) */
  qty: string
  /** `sale_lines.unit_price` */
  unitPrice: string
  discount?: Discount
  /** `sale_lines.tax_rate` نسبة مئوية نصاً، الافتراضي بلا ضريبة */
  taxRate?: string
  /** `taxes.is_inclusive` — الافتراضي شاملة كما في القاعدة */
  taxMode?: TaxMode
}

/** نتيجة السطر بدقّة كاملة، للتجميع قبل التقريب. */
export type LineAmountsDecimal = {
  gross: Decimal
  discountAmount: Decimal
  /** gross − discount: الوعاء الذي تُحسب منه الضريبة */
  taxable: Decimal
  net: Decimal
  taxAmount: Decimal
  lineTotal: Decimal
}

/** نتيجة السطر مقرَّبة كنصوص، جاهزة للتخزين والعرض. */
export type LineAmounts = {
  gross: string
  discountAmount: string
  net: string
  taxAmount: string
  lineTotal: string
}

/** نوع الضريبة الافتراضي: `taxes.is_inclusive` افتراضه `true` في القاعدة. */
export const DEFAULT_TAX_MODE: TaxMode = TAX_MODE.INCLUSIVE

/** يحسب السطر بدقّة كاملة بلا أي تقريب. */
export function calcLineDecimal(line: LineInput): LineAmountsDecimal {
  // المرتجع فاتورة بكميات موجبة والإشارة تُقلب عند التقارير (docs/02 §3.2)،
  // فالكمية والسعر السالبان لا معنى لهما هنا.
  const qty = toNonNegativeDecimal(assertQuantity(line.qty, 'الكمية'), 'الكمية')
  const unitPrice = toNonNegativeDecimal(line.unitPrice, 'سعر الوحدة')
  const gross = qty.times(unitPrice)
  const discountAmount = resolveDiscount(line.discount, gross)

  if (discountAmount.gt(gross)) {
    throw new CoreError(
      CORE_ERROR.LINE_DISCOUNT_TOO_LARGE,
      coreMessages.lineDiscountTooLarge(discountAmount.toString(), gross.toString()),
      'discount'
    )
  }

  const taxable = gross.minus(discountAmount)
  const { net, tax, total } = splitTax(
    taxable,
    line.taxRate ?? ZERO_RATE,
    line.taxMode ?? DEFAULT_TAX_MODE
  )
  return { gross, discountAmount, taxable, net, taxAmount: tax, lineTotal: total }
}

/** يحسب سطراً مفرداً ويقرّبه بعملة الفاتورة. الفاتورة كاملةً في `calcInvoice`. */
export function calcLine(line: LineInput, currency: Currency): LineAmounts {
  const exact = calcLineDecimal(line)
  return composeLineAmounts(
    roundMoney(exact.gross, currency.decimals),
    roundMoney(exact.lineTotal, currency.decimals),
    roundMoney(exact.taxAmount, currency.decimals),
    line.taxMode ?? DEFAULT_TAX_MODE,
    currency.decimals
  )
}

/**
 * يركّب أرقام السطر المعروضة من ثلاث قيم مقرَّبة فقط (gross، lineTotal، tax)
 * ويشتقّ الباقي بالطرح، فيتحقق داخل كل سطر:
 *   `net + taxAmount = lineTotal` و`gross − discountAmount = الوعاء الخاضع`.
 * الاشتقاق (لا التقريب المستقل لكل حقل) هو ما يمنع اختلال السطر بقرش.
 */
export function composeLineAmounts(
  gross: string,
  lineTotal: string,
  taxAmount: string,
  mode: TaxMode,
  decimals: number
): LineAmounts {
  const net = roundMoney(sub(lineTotal, taxAmount), decimals)
  const taxableRounded = mode === TAX_MODE.INCLUSIVE ? lineTotal : net
  return {
    gross,
    discountAmount: roundMoney(sub(gross, taxableRounded), decimals),
    net,
    taxAmount,
    lineTotal,
  }
}

/** يحوّل الخصم (مبلغاً أو نسبة) إلى مبلغ بدقّة كاملة. */
export function resolveDiscount(discount: Discount | undefined, base: DecimalLike): Decimal {
  if (!discount) return ZERO
  if (discount.kind === DISCOUNT_KIND.PERCENT) {
    const factor = parsePercentFactor(discount.value, 'discount', 'نسبة الخصم')
    return toDecimal(base, 'قيمة السطر').times(factor)
  }
  return toNonNegativeDecimal(discount.value, 'قيمة الخصم')
}
