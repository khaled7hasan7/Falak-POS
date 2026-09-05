/**
 * توزيع دفع الفاتورة على عدة عملات (`sale_payments`).
 *
 * docs/02-database.md §1: «كل دفعة تحمل `amount` بعملتها + `exchange_rate` +
 * `amount_base` بالعملة الأساسية».
 *
 * **سعر الصرف مثبّت لحظة الدفع**: يصل مع كل دفعة ولا يُقرأ من `exchange_rates`
 * ولا من أي مكان آخر داخل هذه الدالة. تغيّر السعر غداً لا يغيّر فاتورة اليوم،
 * ولا يمكن لهذه الحزمة أن تقرأ شبكة أو قاعدة أصلاً.
 *
 * الباقي يُعطى بعملة **يختارها المستخدم** وقد تختلف عن عملات الدفع، ولها سعرها
 * المثبّت هي الأخرى. دفع زائد بلا عملة باقٍ محدّدة ⇒ خطأ لا تخمين.
 */
import {
  currencyCode as currencyCodeSchema,
  exchangeRate as exchangeRateSchema,
} from '@falak/contracts'
import { CORE_ERROR, CoreError, coreMessages } from './errors.js'
import {
  allocateRounded,
  assertDecimals,
  type Currency,
  roundMoney,
  sub,
  sum,
  toDecimal,
  toNonNegativeDecimal,
  zeroAmount,
} from './money.js'
import type { Decimal } from 'decimal.js'

export type PaymentInput = {
  /** المبلغ بعملة الدفع */
  amount: string
  /** `sale_payments.currency_code` */
  currencyCode: string
  /** `sale_payments.exchange_rate` — مثبّت لحظة الدفع، أكبر من صفر */
  exchangeRate: string
}

export type SettledPayment = PaymentInput & {
  /** `amount × exchangeRate` بالعملة الأساسية، موزَّع فرق تقريبه فيساوي مجموعه `paidBase` */
  amountBase: string
}

/** عملة الباقي مع سعرها المثبّت لحظة الدفع. */
export type ChangeCurrency = Currency & { exchangeRate: string }

export type SettlementInput = {
  /** إجمالي الفاتورة **بالعملة الأساسية** (`sales.total`) */
  total: string
  payments: readonly PaymentInput[]
  /** العملة الأساسية للمستأجر (`tenants.base_currency`) */
  baseCurrency: Currency
  /** عملة الباقي — إلزامية فقط عند الدفع الزائد */
  changeCurrency?: ChangeCurrency
}

export type SettlementResult = {
  payments: SettledPayment[]
  /** مجموع المدفوع بالعملة الأساسية */
  paidBase: string
  /** الباقي المستحق للزبون بالعملة الأساسية (صفر إن لا يوجد) */
  changeBase: string
  /** الباقي كما يُسلَّم فعلاً بعملته، و`amountBase` قيمته المحاسبية بعد تقريبه لعملته */
  change: SettledPayment | null
  /** المتبقي على حساب العميل إن كان الدفع أقل (`sales.due_total`) */
  dueBase: string
}

/** يوزّع الدفع ويحسب الباقي والمتبقي. دالة نقية: لا قاعدة ولا شبكة ولا وقت. */
export function settlePayments(input: SettlementInput): SettlementResult {
  const decimals = assertDecimals(input.baseCurrency.decimals)
  const total = toNonNegativeDecimal(input.total, 'إجمالي الفاتورة')

  const exactBase = input.payments.map(toBaseAmount)
  const paidBase = roundMoney(sum(exactBase), decimals)
  const amountsBase = allocateRounded(exactBase, paidBase, decimals)

  const payments: SettledPayment[] = input.payments.map((payment, index) => ({
    ...payment,
    // الأطوال متساوية بالبناء؛ `??` احتياط للنوع لا سلوك متوقَّع.
    amountBase: amountsBase[index] ?? zeroAmount(decimals),
  }))

  const balance = sub(paidBase, roundMoney(total, decimals))
  if (balance.isNegative()) {
    return {
      payments,
      paidBase,
      changeBase: zeroAmount(decimals),
      change: null,
      dueBase: roundMoney(balance.negated(), decimals),
    }
  }

  const changeBase = roundMoney(balance, decimals)
  return {
    payments,
    paidBase,
    changeBase,
    change: balance.isZero() ? null : buildChange(changeBase, input.changeCurrency, decimals),
    dueBase: zeroAmount(decimals),
  }
}

/** `amount × exchangeRate` بدقّة كاملة، بعد التحقق من الدفعة. */
function toBaseAmount(payment: PaymentInput): Decimal {
  const amount = toNonNegativeDecimal(payment.amount, 'مبلغ الدفعة')
  assertCurrencyCode(payment.currencyCode)
  return amount.times(assertExchangeRate(payment.exchangeRate))
}

/**
 * يحوّل الباقي من العملة الأساسية إلى عملة الباقي المختارة.
 * `amount` ما يُسلَّم فعلاً (مقرَّباً بمنازل عملته)، و`amountBase` قيمته المحاسبية
 * بعد ذلك التقريب — وهي ما يدخل `cash_movements`، لا الفرق النظري.
 */
function buildChange(
  changeBase: string,
  currency: ChangeCurrency | undefined,
  baseDecimals: number
): SettledPayment {
  if (!currency) {
    throw new CoreError(
      CORE_ERROR.CHANGE_CURRENCY_MISSING,
      coreMessages.changeCurrencyMissing(changeBase),
      'changeCurrency'
    )
  }
  const rate = assertExchangeRate(currency.exchangeRate)
  assertCurrencyCode(currency.code)
  const amount = roundMoney(toDecimal(changeBase).div(rate), assertDecimals(currency.decimals))
  return {
    amount,
    currencyCode: currency.code,
    exchangeRate: currency.exchangeRate,
    amountBase: roundMoney(toDecimal(amount).times(rate), baseDecimals),
  }
}

/** سعر الصرف: صيغة `numeric(14,6)` من @falak/contracts، وأكبر من صفر. */
function assertExchangeRate(value: string): Decimal {
  const parsed = exchangeRateSchema.safeParse(value)
  if (!parsed.success) {
    throw new CoreError(
      CORE_ERROR.INVALID_EXCHANGE_RATE,
      coreMessages.invalidExchangeRate(value),
      'exchangeRate'
    )
  }
  const rate = toDecimal(parsed.data, 'exchangeRate')
  if (rate.isZero()) {
    throw new CoreError(
      CORE_ERROR.INVALID_EXCHANGE_RATE,
      coreMessages.invalidExchangeRate(value),
      'exchangeRate'
    )
  }
  return rate
}

/** رمز العملة: `char(3)` بأحرف لاتينية كبيرة من @falak/contracts. */
function assertCurrencyCode(value: string): string {
  const parsed = currencyCodeSchema.safeParse(value)
  if (!parsed.success) {
    throw new CoreError(
      CORE_ERROR.INVALID_CURRENCY_CODE,
      coreMessages.invalidCurrencyCode(value),
      'currencyCode'
    )
  }
  return parsed.data
}
