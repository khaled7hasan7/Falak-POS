/**
 * حساب الفاتورة من أسطرها (`sales` + `sale_lines`).
 *
 * ## التسلسل
 * 1. كل سطر يُحسب بدقّة كاملة: `gross − خصم السطر = الوعاء`.
 * 2. **خصم الفاتورة يُوزَّع تناسبياً على الأسطر _قبل_ حساب الضريبة**، فيبقى
 *    وعاء الضريبة صحيحاً ولا تُدفع ضريبة على مال لم يُقبض.
 * 3. الضريبة تُحسب لكل سطر بعد الخصمين.
 * 4. **الجمع قبل التقريب** (ADR-002 §5): تُجمع الأسطر بدقّة كاملة ويُقرَّب
 *    كل إجمالي **مرة واحدة**، ثم تُوزَّع فروق التقريب على الأسطر بطريقة أكبر
 *    الباقي فيساوي مجموع الأسطر الإجمالي بالضبط — **لا قرش ضائع**.
 *
 * ## معنى الأعمدة
 * `subtotal` و`discountTotal` **بأساس الأسعار المدخلة**: إن كانت الأسعار شاملة
 * الضريبة فهما شاملان لها، فيرى الزبون الخصم الذي أُعطي له بالضبط لا نسخته الصافية.
 * أما العلاقة المضمونة في الحالتين فهي:
 *
 *     total = netTotal + taxTotal
 *
 * ومنها يُشتق `netTotal` طرحاً (لا بتقريب مستقل) فلا يختل الميزان بقرش.
 */
import { CORE_ERROR, CoreError, coreMessages } from './errors.js'
import {
  allocateRounded,
  assertDecimals,
  type Currency,
  Dec,
  roundMoney,
  sub,
  sum,
  ZERO,
  zeroAmount,
} from './money.js'
import {
  calcLineDecimal,
  composeLineAmounts,
  DEFAULT_TAX_MODE,
  type Discount,
  type LineAmounts,
  type LineInput,
  resolveDiscount,
} from './line.js'
import { splitTax, ZERO_RATE } from './tax.js'
import type { Decimal } from 'decimal.js'

export type InvoiceInput = {
  lines: readonly LineInput[]
  /** خصم على مستوى الفاتورة: مبلغ أو نسبة. أكبر من إجمالي الأسطر يُرفض. */
  discount?: Discount
  /** عملة الفاتورة — منها يأتي عدد المنازل (`currencies.decimals`) */
  currency: Currency
}

export type InvoiceResult = {
  /** أسطر مقرَّبة مجموعها يطابق الإجماليات بالضبط، بترتيب المدخلات */
  lines: LineAmounts[]
  /** Σ (qty × unitPrice) قبل أي خصم، بأساس الأسعار المدخلة */
  subtotal: string
  /** خصم الأسطر + خصم الفاتورة، بنفس الأساس */
  discountTotal: string
  /** الصافي قبل الضريبة = total − taxTotal */
  netTotal: string
  taxTotal: string
  /** المستحق على الزبون */
  total: string
}

/** يحسب الفاتورة كاملة. المدخلات والمخرجات المالية نصوص (ADR-002 §3). */
export function calcInvoice(input: InvoiceInput): InvoiceResult {
  const decimals = assertDecimals(input.currency.decimals)
  if (input.lines.length === 0) {
    throw new CoreError(CORE_ERROR.EMPTY_INVOICE, coreMessages.emptyInvoice(), 'lines')
  }

  const prepared = input.lines.map((line) => ({
    line,
    mode: line.taxMode ?? DEFAULT_TAX_MODE,
    amounts: calcLineDecimal(line),
  }))

  // وعاء خصم الفاتورة: مجموع الأسطر بعد خصومها الخاصة.
  const weights = prepared.map((p) => p.amounts.taxable)
  const invoiceDiscount = resolveInvoiceDiscount(input.discount, sum(weights))
  const shares = spreadProportionally(weights, invoiceDiscount)

  // الضريبة بعد الخصمين — هنا يبقى وعاء الضريبة صحيحاً.
  const exact = prepared.map((p, index) => {
    const taxable = p.amounts.taxable.minus(shares[index] ?? ZERO)
    const split = splitTax(taxable, p.line.taxRate ?? ZERO_RATE, p.mode)
    return { gross: p.amounts.gross, mode: p.mode, ...split }
  })

  // تقريب واحد لكل إجمالي، بعد الجمع بدقّة كاملة.
  const subtotal = roundMoney(sum(exact.map((e) => e.gross)), decimals)
  const taxTotal = roundMoney(sum(exact.map((e) => e.tax)), decimals)
  const total = roundMoney(sum(exact.map((e) => e.total)), decimals)

  // توزيع فروق التقريب: مجموع كل عمود = إجماليه بالضبط.
  const grosses = allocateRounded(
    exact.map((e) => e.gross),
    subtotal,
    decimals
  )
  const taxes = allocateRounded(
    exact.map((e) => e.tax),
    taxTotal,
    decimals
  )
  const lineTotals = allocateRounded(
    exact.map((e) => e.total),
    total,
    decimals
  )

  // الأطوال متساوية بالبناء؛ `??` احتياط للنوع لا سلوك متوقَّع.
  const lines = exact.map((e, index) =>
    composeLineAmounts(
      grosses[index] ?? zeroAmount(decimals),
      lineTotals[index] ?? zeroAmount(decimals),
      taxes[index] ?? zeroAmount(decimals),
      e.mode,
      decimals
    )
  )

  return {
    lines,
    subtotal,
    discountTotal: roundMoney(sum(lines.map((l) => l.discountAmount)), decimals),
    netTotal: roundMoney(sub(total, taxTotal), decimals),
    taxTotal,
    total,
  }
}

/** خصم الفاتورة كمبلغ. أكبر من وعاء الخصم ⇒ رفض صريح لا قصّ صامت. */
function resolveInvoiceDiscount(discount: Discount | undefined, base: Decimal): Decimal {
  const amount = resolveDiscount(discount, base)
  if (amount.gt(base)) {
    throw new CoreError(
      CORE_ERROR.INVOICE_DISCOUNT_TOO_LARGE,
      coreMessages.invoiceDiscountTooLarge(amount.toString(), base.toString()),
      'discount'
    )
  }
  return amount
}

/**
 * يوزّع مبلغاً على أوزان تناسبياً بدقّة كاملة.
 * حصة السطر الأخير = المتبقي طرحاً، فيساوي المجموع المبلغ **بالضبط**
 * ولا يبتلع باقي القسمة سطراً واحداً.
 */
export function spreadProportionally(weights: readonly Decimal[], amount: Decimal): Decimal[] {
  const totalWeight = weights.reduce((acc, w) => acc.plus(w), new Dec(0))
  if (amount.isZero() || totalWeight.isZero()) return weights.map(() => ZERO)

  let assigned = new Dec(0)
  return weights.map((weight, index) => {
    const share =
      index === weights.length - 1 ? amount.minus(assigned) : amount.times(weight).div(totalWeight)
    assigned = assigned.plus(share)
    return share
  })
}
