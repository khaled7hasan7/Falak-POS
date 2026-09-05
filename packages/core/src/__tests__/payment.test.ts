import { describe, expect, it } from 'vitest'
import { settlePayments } from '../payment.js'
import { toBaseQty, fromBaseQty } from '../units.js'
import { applyCashRounding, CASH_ROUNDING_MODE, DEFAULT_CASH_ROUNDING } from '../rounding.js'
import { CoreError } from '../errors.js'
import type { Currency } from '../money.js'

/**
 * الدفع متعدد العملات، تحويل الوحدات، والتقريب النقدي.
 * المرجع: `docs/02-database.md §1` (المال بعملتين) و`§5.4` و ADR-002 و ADR-004.
 */

const ILS: Currency = { code: 'ILS', decimals: 2, symbol: '₪' }
const JOD: Currency = { code: 'JOD', decimals: 3, symbol: 'د.أ' }

describe('settlePayments — الدفع متعدد العملات', () => {
  it('دفع بالعملة الأساسية بالضبط: لا باقٍ ولا متبقٍّ', () => {
    const result = settlePayments({
      total: '120.00',
      payments: [{ amount: '120.00', currencyCode: 'ILS', exchangeRate: '1' }],
      baseCurrency: ILS,
    })
    expect(result.paidBase).toBe('120.00')
    expect(result.changeBase).toBe('0.00')
    expect(result.dueBase).toBe('0.00')
    expect(result.change).toBeNull()
  })

  it('شيكل + دينار بسعر صرف مثبّت، والباقي بالشيكل', () => {
    // فاتورة 200 ₪ · دفع 100 ₪ + 20 د.أ بسعر 5.00 ⇒ 100 + 100 = 200… ثم زيادة
    const result = settlePayments({
      total: '180.00',
      payments: [
        { amount: '100.00', currencyCode: 'ILS', exchangeRate: '1' },
        { amount: '20.000', currencyCode: 'JOD', exchangeRate: '5.000000' },
      ],
      baseCurrency: ILS,
      changeCurrency: { ...ILS, exchangeRate: '1' },
    })

    expect(result.payments[0]!.amountBase).toBe('100.00')
    expect(result.payments[1]!.amountBase).toBe('100.00')
    expect(result.paidBase).toBe('200.00')
    expect(result.changeBase).toBe('20.00')
    expect(result.dueBase).toBe('0.00')
    expect(result.change?.currencyCode).toBe('ILS')
    expect(result.change?.amount).toBe('20.00')
  })

  it('الباقي بعملة ثالثة يُحوَّل بسعرها المثبّت', () => {
    const result = settlePayments({
      total: '100.00',
      payments: [{ amount: '150.00', currencyCode: 'ILS', exchangeRate: '1' }],
      baseCurrency: ILS,
      // الباقي 50 ₪ يُسلَّم ديناراً بسعر 5 ⇒ 10.000 د.أ
      changeCurrency: { ...JOD, exchangeRate: '5.000000' },
    })
    expect(result.changeBase).toBe('50.00')
    expect(result.change?.currencyCode).toBe('JOD')
    expect(result.change?.amount).toBe('10.000')
    expect(result.change?.amountBase).toBe('50.00')
  })

  it('الدفع الناقص يترك متبقياً على الحساب ولا باقٍ', () => {
    const result = settlePayments({
      total: '250.00',
      payments: [{ amount: '100.00', currencyCode: 'ILS', exchangeRate: '1' }],
      baseCurrency: ILS,
    })
    expect(result.paidBase).toBe('100.00')
    expect(result.dueBase).toBe('150.00')
    expect(result.changeBase).toBe('0.00')
    expect(result.change).toBeNull()
  })

  it('الدفع الزائد بلا عملة باقٍ محدّدة يُرفض', () => {
    expect(() =>
      settlePayments({
        total: '100.00',
        payments: [{ amount: '150.00', currencyCode: 'ILS', exchangeRate: '1' }],
        baseCurrency: ILS,
      })
    ).toThrowError(CoreError)
  })

  it('سعر صرف صفر أو سالب يُرفض', () => {
    expect(() =>
      settlePayments({
        total: '10.00',
        payments: [{ amount: '10.00', currencyCode: 'JOD', exchangeRate: '0' }],
        baseCurrency: ILS,
      })
    ).toThrowError(CoreError)
  })

  it('مجموع amountBase للدفعات يساوي paidBase بالضبط', () => {
    const result = settlePayments({
      total: '99.99',
      payments: [
        { amount: '33.33', currencyCode: 'ILS', exchangeRate: '1' },
        { amount: '6.667', currencyCode: 'JOD', exchangeRate: '4.990000' },
        { amount: '10.00', currencyCode: 'USD', exchangeRate: '3.330000' },
      ],
      baseCurrency: ILS,
      changeCurrency: { ...ILS, exchangeRate: '1' },
    })

    const sumOfPayments = result.payments.reduce((acc, p) => acc + Number(p.amountBase), 0)
    expect(sumOfPayments.toFixed(2)).toBe(result.paidBase)
  })

  it('السعر المُمرَّر هو المستخدم — لا يُقرأ سعر من مكان آخر', () => {
    const cheap = settlePayments({
      total: '0.00',
      payments: [{ amount: '10.000', currencyCode: 'JOD', exchangeRate: '4.000000' }],
      baseCurrency: ILS,
      changeCurrency: { ...ILS, exchangeRate: '1' },
    })
    const dear = settlePayments({
      total: '0.00',
      payments: [{ amount: '10.000', currencyCode: 'JOD', exchangeRate: '5.000000' }],
      baseCurrency: ILS,
      changeCurrency: { ...ILS, exchangeRate: '1' },
    })
    expect(cheap.paidBase).toBe('40.00')
    expect(dear.paidBase).toBe('50.00')
  })
})

describe('units — التحويل بالـ factor', () => {
  it('كرتونة بعامل 24: ثلاث كراتين = 72 حبة (القاعدة 3)', () => {
    expect(toBaseQty('3.000', '24.000')).toBe('72.000')
  })

  it('العامل 1 لا يغيّر الكمية', () => {
    expect(toBaseQty('7.500', '1.000')).toBe('7.500')
  })

  it('العكس يعيد الكمية الأصلية', () => {
    expect(fromBaseQty('72.000', '24.000')).toBe('3.000')
  })

  it('كمية موزونة بثلاث منازل تبقى دقيقة', () => {
    expect(toBaseQty('1.235', '1.000')).toBe('1.235')
  })

  it('عامل صفر أو سالب يُرفض', () => {
    expect(() => toBaseQty('1.000', '0')).toThrowError(CoreError)
    expect(() => toBaseQty('1.000', '-2.000')).toThrowError(CoreError)
  })
})

describe('applyCashRounding — التقريب النقدي (ADR-004)', () => {
  it('معطّل افتراضياً: يعيد الإجمالي كما هو بفرق صفر', () => {
    const result = applyCashRounding('17.37', DEFAULT_CASH_ROUNDING, ILS)
    expect(result.total).toBe('17.37')
    expect(result.adjustment).toBe('0.00')
  })

  it('نصف شيكل لأقرب وحدة', () => {
    const setting = { enabled: true, increment: '0.50', mode: CASH_ROUNDING_MODE.NEAREST }
    expect(applyCashRounding('17.30', setting, ILS).total).toBe('17.50')
    expect(applyCashRounding('17.20', setting, ILS).total).toBe('17.00')
    expect(applyCashRounding('17.25', setting, ILS).total).toBe('17.50')
  })

  it('لأعلى دائماً ولأسفل دائماً', () => {
    const up = { enabled: true, increment: '0.50', mode: CASH_ROUNDING_MODE.UP }
    const down = { enabled: true, increment: '0.50', mode: CASH_ROUNDING_MODE.DOWN }
    expect(applyCashRounding('17.10', up, ILS).total).toBe('17.50')
    expect(applyCashRounding('17.90', down, ILS).total).toBe('17.50')
  })

  it('الفرق يُبلَّغ بإشارته: موجب لصالح المحل وسالب لصالح الزبون', () => {
    const setting = { enabled: true, increment: '0.50', mode: CASH_ROUNDING_MODE.NEAREST }
    expect(applyCashRounding('17.30', setting, ILS).adjustment).toBe('0.20')
    expect(applyCashRounding('17.20', setting, ILS).adjustment).toBe('-0.20')
  })

  it('مبلغ على وحدة التقريب تماماً لا يتغيّر', () => {
    const setting = { enabled: true, increment: '0.50', mode: CASH_ROUNDING_MODE.NEAREST }
    const result = applyCashRounding('17.50', setting, ILS)
    expect(result.total).toBe('17.50')
    expect(result.adjustment).toBe('0.00')
  })

  it('يحترم منازل العملة: الدينار بثلاث منازل', () => {
    const setting = { enabled: true, increment: '0.005', mode: CASH_ROUNDING_MODE.NEAREST }
    const result = applyCashRounding('7.003', setting, JOD)
    expect(result.total).toBe('7.005')
    expect(result.total.split('.')[1]).toHaveLength(3)
  })

  it('وحدة تقريب صفر أو سالبة تُرفض', () => {
    expect(() =>
      applyCashRounding('10.00', { enabled: true, increment: '0', mode: 'nearest' }, ILS)
    ).toThrowError(CoreError)
  })
})
